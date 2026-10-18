import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Add the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Do it", description: "Do the thing" }],
    testPlan: "Run the tests",
    confidence: 0.9,
    ...overrides,
  };
}

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Add the thing",
      description: "desc",
      branchName: "ai/lin-1",
      labels: [],
      priority: 1,
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 100,
        maxDiffLines: 5000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 100,
        maxDiffLines: 5000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree2", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans from scratch using prior artifacts and proceeds to plan review when there are no blockers", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan({ planVersion: 1 }) });
      return Promise.resolve(null);
    });
    const newPlan = makePlan({ planVersion: 2 });
    deps.plannerAgent.run.mockResolvedValue(newPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2, previousPlan: expect.anything() }),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const blockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(blockedPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("forwards prior rejection feedback, human answers, researched answers, and plan review findings when present", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve({ payloadJson: { planVersion: 3, feedback: "too slow", source: "api", mode: "iterate" } });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan({ planVersion: 3 }) });
      if (type === "HumanAnswers")
        return Promise.resolve({ payloadJson: { answers: [{ questionId: "q1", answer: "prod" }] } });
      if (type === "ResearchedAnswers")
        return Promise.resolve({
          payloadJson: {
            summary: "s",
            completedAt: "2026-01-01T00:00:00Z",
            answers: [{ questionId: "q1", question: "Which env?", answer: "prod", confidence: "high" }],
          },
        });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] },
        });
      return Promise.resolve(null);
    });
    const newPlan = makePlan({ planVersion: 4 });
    deps.plannerAgent.run.mockResolvedValue(newPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 4 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    const call = deps.plannerAgent.run.mock.calls[0][2];
    expect(call.humanFeedback).toEqual({ planVersion: 3, feedback: "too slow" });
    expect(call.humanAnswers).toEqual([{ questionId: "q1", answer: "prod" }]);
    expect(call.researchedAnswers).toHaveLength(1);
    expect(call.planReviewFindings.summary).toBe("review summary");
  });
});

describe("OrchestratorService.retryRun", () => {
  it("creates a new worktree when the run has no branch yet, then plans and reviews", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: null }));
    deps.runRepo.update.mockResolvedValueOnce(
      makeRun({ state: RunState.Todo, workingDirectory: "/tmp/worktree2", branchName: "ai/run-1" }),
    );
    const newPlan = makePlan();
    deps.plannerAgent.run.mockResolvedValue(newPlan);
    deps.runRepo.update.mockResolvedValueOnce(
      makeRun({ state: RunState.Planning, planVersion: 1, branchName: "ai/run-1" }),
    );
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(deps.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("re-uses the existing branch/worktree when the run already has one", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
    );
    deps.plannerAgent.run.mockResolvedValue(makePlan());
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(deps.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the retried plan has blocking questions", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
    );
    const blockedPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(blockedPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("approved: transitions to AwaitingPlanApproval and posts the plan summary", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested: posts review findings and delegates to runPlanRevision", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
    });
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when there is no plan artifact", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps the plan version, transitions, and posts the revision comment", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { reviewId: "rev-1", summary: "s", findings: [], overallVerdict: "changes_requested" },
        });
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 2 });
    deps.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "rev-1",
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "fair point" }],
      },
      revisedPlan,
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(deps.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
    expect(deps.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("accepted"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes no operator-note option to the reviser when none is given", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { reviewId: "rev-1", summary: "s", findings: [], overallVerdict: "changes_requested" },
        });
      return Promise.resolve(null);
    });
    deps.planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, reviewId: "rev-1", dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(deps.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});
