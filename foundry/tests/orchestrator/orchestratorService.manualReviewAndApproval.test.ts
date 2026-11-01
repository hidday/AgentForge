import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(): Plan {
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
    findLatestByType: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/run-1",
      state: "AwaitingPlanApproval",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
  };
}

function spyBuildTaskBundle(svc: OrchestratorService) {
  return vi
    .spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle")
    .mockResolvedValue({
      issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: [],
    });
}

describe("OrchestratorService.runManualReReview", () => {
  it("throws when no Plan artifact exists", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("always returns to AwaitingPlanApproval, even when the reviewer requests changes", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Needs changes",
      findings: [{ id: "f1", severity: "blocker", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "RE_REVIEW_REQUESTED", payloadJson: expect.objectContaining({ trigger: "re-review" }) }),
    );
  });

  it("includes the note in the recorded trigger event and passes it as an operatorNote to the plan reviewer", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    await svc.runManualReReview("run-1", { note: "Double check auth" });

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "RE_REVIEW_REQUESTED",
        payloadJson: expect.objectContaining({ trigger: "re-review", note: "Double check auth" }),
      }),
    );
    const reviewerCall = deps.planReviewerAgent.run.mock.calls[0];
    expect(reviewerCall[3]).toEqual({ operatorNote: "Double check auth" });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when no Plan artifact exists", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("when the reviewer approves: stays at AwaitingPlanApproval without calling runPlanRevision", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("when the reviewer requests changes: transitions to PlanRevision and delegates to runPlanRevision with the note", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualPlanRevision("run-1", { note: "Simplify step 2" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "Simplify step 2" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions the run to Done and posts the completion comment", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("is a no-op when there is no distillationAgent configured (optional dependency)", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);

    await expect(svc.approveHumanReview("run-1")).resolves.toBeDefined();
  });
});
