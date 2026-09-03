import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { RejectionContextPayload, HumanAnswer } from "../../src/domain/types.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";
import { buildDeps, makeStore, pushArtifact, mockPlannerProducesPlan } from "./helpers/fixtures.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function approvedPlanReview(): PlanReview {
  return { reviewId: "pr-1", summary: "Looks fine", findings: [], overallVerdict: "approved" };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without contacting Linear when one already exists for the issue", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const activeRun = { ...store.run, state: RunState.Implementing };
    built.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(built.linearClient.getIssue).not.toHaveBeenCalled();
    expect(built.runRepo.create).not.toHaveBeenCalled();
  });

  it("creates a run, sets up the worktree, plans, and (with no blocking questions) proceeds through plan review to AwaitingPlanApproval", async () => {
    const store = makeStore({ state: RunState.Todo, planVersion: 0 });
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 1 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/test-repo",
      "run-1",
      "main",
      "ai/run-1",
    );
    expect(built.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);

    expect(built.artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TaskBundle" }),
    );
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the plan has blocking open questions, and does not call the plan reviewer", async () => {
    const store = makeStore({ state: RunState.Todo, planVersion: 0 });
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(clarificationEvent).toBeDefined();
    expect(
      (clarificationEvent![0] as { payloadJson: { blockingQuestions: unknown[] } }).payloadJson
        .blockingQuestions,
    ).toEqual([{ id: "q1", question: "Which auth provider?" }]);
  });

  it("retrieves and injects prior skills into the planner call when agentSkillRepo is configured", async () => {
    const store = makeStore({ state: RunState.Todo, planVersion: 0, linearIssueTitle: "Add auth" });
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 1 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());
    const skills = [
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "auth-skill",
        description: "auth",
        taskCategory: "auth",
        skillMarkdown: "# auth",
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
    ];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };

    const svc = new OrchestratorService({ ...built.deps, agentSkillRepo } as never);
    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.any(String), 3);
    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: skills }),
    );
    const injectionEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: null });
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 1 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(built.gitService.resolveMainRepoPath).toHaveBeenCalledWith("/tmp/worktree");
    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ branchName: "ai/run-1" }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 1 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with no prior context artifacts and proceeds to plan review when there are no blockers", async () => {
    const store = makeStore({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 2 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    // None of the optional context extras should be present.
    const callArgs = built.plannerAgent.run.mock.calls[0]![2] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanFeedback");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings when the corresponding artifacts exist", async () => {
    const store = makeStore({ state: RunState.Planning, planVersion: 1 });
    const previousPlan = makePlan({ planVersion: 1 });
    pushArtifact(store, "Plan", 1, previousPlan);
    const rejectionPayload: RejectionContextPayload = {
      planVersion: 1,
      feedback: "Use OAuth2",
      source: "api",
      mode: "iterate",
    };
    pushArtifact(store, "RejectionContext", 1, rejectionPayload);
    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "Use Postgres" }];
    pushArtifact(store, "HumanAnswers", 1, { answers: humanAnswers, submittedAt: new Date().toISOString() });
    const researchedAnswers: ResearchedAnswers = {
      summary: "Researched",
      answers: [
        { questionId: "q2", question: "Which region?", answer: "us-east-1", confidence: "high" },
      ],
      completedAt: new Date().toISOString(),
    };
    pushArtifact(store, "ResearchedAnswers", 1, researchedAnswers);
    pushArtifact(store, "PlanReview", 1, {
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "detail" }],
    });

    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 2 }));
    built.planReviewerAgent.run.mockResolvedValue(approvedPlanReview());

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
        humanAnswers,
        researchedAnswers: researchedAnswers.answers,
        planReviewFindings: { summary: "Needs work", findings: expect.any(Array) },
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store = makeStore({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which cloud?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
