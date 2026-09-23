import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makeTaskBundle,
  makeLinearIssue,
  makeRepoEntry,
  makeResearchedAnswers,
} from "./_helpers/fixtures.js";

describe("OrchestratorService.runPlanning", () => {
  it("re-plans from Planning state, persists TaskBundle if missing, and proceeds to plan review when no blockers remain", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildFullDeps(run);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    // Simulates the real plannerAgent persisting the Plan artifact as a side effect.
    artifactRepo.seed("Plan", newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Great",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    // TaskBundle artifact should have been persisted (didn't previously exist)
    expect(artifactRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: "TaskBundle" }));
    // Plan version updated on the run
    expect(runRepo.getCurrent().planVersion).toBe(2);
    // Ends up in AwaitingPlanApproval after Planning -> PlanReview -> PLAN_REVIEW_APPROVED
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects previousPlan, rejectionContext, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);

    const previousPlan = makePlan({ planVersion: 2 });
    artifactRepo.seed("Plan", previousPlan);
    artifactRepo.seed("RejectionContext", {
      planVersion: 2,
      feedback: "Use OAuth2",
      source: "api",
      mode: "iterate",
    });
    artifactRepo.seed("HumanAnswers", {
      answers: [{ questionId: "q1", answer: "yes" }],
      submittedAt: new Date().toISOString(),
    });
    artifactRepo.seed("ResearchedAnswers", makeResearchedAnswers());
    artifactRepo.seed("PlanReview", {
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "details" }],
    });

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "q1" })]),
        planReviewFindings: expect.objectContaining({ summary: "Needs work" }),
      }),
    );
  });

  it("pauses for human clarification when the re-planned plan still has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent } = buildFullDeps(run);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("does not persist a second TaskBundle artifact when one already exists", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    const taskBundleCreateCalls = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => (call[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCreateCalls).toHaveLength(0);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a worktree when the run has no branchName, then plans and reviews", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, planVersion: 1 });
    const { deps, runRepo, artifactRepo, gitService, plannerAgent, planReviewerAgent } = buildFullDeps(run);

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      expect.any(String),
    );
    expect(runRepo.getCurrent().branchName).toBe("ai/run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const { deps, artifactRepo, gitService, plannerAgent } = buildFullDeps(run);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("falls back to repoRegistry.getDefaultRepo when the run's repo is unknown", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, repo: "unknown-repo" });
    const { deps, artifactRepo, repoRegistry, plannerAgent } = buildFullDeps(run);
    repoRegistry.getRepoByName.mockReturnValue(undefined);
    repoRegistry.getDefaultRepo.mockReturnValue(makeRepoEntry({ name: "default-repo" }));
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("pauses for human clarification when the plan has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const { deps, plannerAgent, planReviewerAgent } = buildFullDeps(run);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("passes prior skills from agentSkillRepo into the planner when configured", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const skill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "auth-skill",
      description: "Handles auth",
      taskCategory: "auth",
      skillMarkdown: "# Auth",
      utilityScore: 1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([skill]) };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildFullDeps(run, { agentSkillRepo });
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [skill] }),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one when one already exists", async () => {
    const activeRun = makeRun({ id: "existing-run", state: RunState.Planning });
    const { deps, runRepo, linearClient } = buildFullDeps(activeRun);
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(activeRun);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("creates a new run, sets up the worktree, plans, and proceeds to plan review", async () => {
    const seedRun = makeRun({ id: "run-1", state: RunState.Todo });
    const { deps, runRepo, artifactRepo, gitService, dashboardEmitter, plannerAgent, planReviewerAgent } =
      buildFullDeps(seedRun);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(seedRun);
    linearIssueMock(deps);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  function linearIssueMock(deps: { linearClient: { getIssue: ReturnType<typeof vi.fn> } }) {
    deps.linearClient.getIssue.mockResolvedValue(makeLinearIssue());
  }
});
