import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
} from "./_helpers/fixtures.js";

// buildTaskBundle is private; exercise it indirectly through a public method
// that calls it early (runPlanReview requires only a Plan artifact + issue lookup).
describe("OrchestratorService buildTaskBundle (via runPlanReview)", () => {
  it("uses the remote GitHub default branch when it differs from the configured one", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, githubClient, planReviewerAgent, logger } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "trunk" }) }),
      "run-1",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the configured default branch when GitHub lookup throws", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, githubClient, planReviewerAgent, logger } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    githubClient.getDefaultBranch.mockRejectedValue(new Error("API down"));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
      "run-1",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "API down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("includes relatedContext in the bundle when the parent or blockers are present", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    linearClient.getRelatedContext.mockResolvedValue({
      parent: { id: "PARENT-1", title: "Parent issue", description: "", state: "Todo", labels: [], priority: 0 },
      blockers: [],
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relatedContext: expect.objectContaining({
          parent: expect.objectContaining({ id: "PARENT-1" }),
        }),
      }),
      "run-1",
    );
  });

  it("omits relatedContext when there is no parent and no blockers", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    linearClient.getRelatedContext.mockResolvedValue({ blockers: [] });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const bundleArg = planReviewerAgent.run.mock.calls[0][1] as { relatedContext?: unknown };
    expect(bundleArg.relatedContext).toBeUndefined();
  });

  it("proceeds without relatedContext when getRelatedContext throws", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, linearClient, planReviewerAgent, logger } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    linearClient.getRelatedContext.mockRejectedValue(new Error("linear down"));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const bundleArg = planReviewerAgent.run.mock.calls[0][1] as { relatedContext?: unknown };
    expect(bundleArg.relatedContext).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "linear down" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService execution report comment formatting (via runExecution)", () => {
  it("collapses the file list into a <details> block when more than 8 files changed, and includes notes", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X", "Also Y"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Execution Report"),
    );
    expect(commentCall).toBeDefined();
    const body = commentCall![1] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });

  it("lists files inline (no <details>) when 8 or fewer files changed, and omits the Notes section when empty", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"], notes: [] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Execution Report"),
    );
    const body = commentCall![1] as string;
    expect(body).not.toContain("<details>");
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("### Notes");
  });

  it("omits the Files changed section entirely when no files were changed", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Execution Report"),
    );
    const body = commentCall![1] as string;
    expect(body).not.toContain("Files changed");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning (via startRun)", () => {
  it("returns [] and never queries when agentSkillRepo is not configured", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);
    const newPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildFullDeps(run, { agentSkillRepo });
    const newPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.seed("Plan", newPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
    const injectionEvents = eventRepo._events.filter((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvents).toHaveLength(0);
  });
});

describe("OrchestratorService.updateSkillMetrics (via transitionAndRecord into Done/Failed)", () => {
  it("increments success and calls archiveIfLowUtility for each distinct skill injected across multiple planning passes, on a successful run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const updatedSkill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "s",
      description: "d",
      taskCategory: "t",
      skillMarkdown: "#",
      utilityScore: 1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = buildFullDeps(run, { agentSkillRepo });

    // Simulate two separate planning passes that each injected overlapping skill ids.
    await eventRepo.create({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
    });
    await eventRepo.create({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-2", "skill-3"] },
    });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(3);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-3");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(3);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments failure for injected skills when the run transitions to Failed", async () => {
    // HumanClarificationNeeded -> Failed via CLARIFICATION_EXHAUSTED is a valid transition.
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 3 });
    const updatedSkill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "s",
      description: "d",
      taskCategory: "t",
      skillMarkdown: "#",
      utilityScore: 1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo, artifactRepo, plannerAgent } = buildFullDeps(run, { agentSkillRepo });
    artifactRepo.seed("Plan", makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }));
    artifactRepo.seed("TaskBundle", { issue: { id: "LIN-1" } });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 4,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    await eventRepo.create({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
    });
    // 3 prior NEEDS_HUMAN_CLARIFICATION events triggers the max-iterations path.
    await eventRepo.create({ runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent" });
    await eventRepo.create({ runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent" });
    await eventRepo.create({ runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent" });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still stuck" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("swallows errors from agentSkillRepo calls (best-effort) without failing the transition", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo, logger } = buildFullDeps(run, { agentSkillRepo });
    await eventRepo.create({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1" }),
      "Failed to update skill metric",
    );
  });

  it("does nothing when agentSkillRepo is not configured", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const { deps } = buildFullDeps(run);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does nothing when no SKILL_INJECTION events were recorded", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildFullDeps(run, { agentSkillRepo });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});
