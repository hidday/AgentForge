import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildDeps(initialRun: Run, extraDeps: Record<string, unknown> = {}) {
  let currentRun = initialRun;
  const artifacts = new Map<string, unknown>([["Plan", { payloadJson: makePlan() }]]);

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockImplementation((_id: string, type: string) =>
        Promise.resolve(artifacts.get(type) ?? null),
      ),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
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
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
    deps: {
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
      ...extraDeps,
    },
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    logger,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no Plan artifact exists for the run", async () => {
    const built = buildDeps(makeRun());
    built.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: records RE_REVIEW_REQUESTED then returns to AwaitingPlanApproval", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1", { note: "double check step 1" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const reReviewCall = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )!;
    expect((reReviewCall[0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      trigger: "re-review",
      note: "double check step 1",
    });
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check step 1" },
    );
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const built = buildDeps(makeRun());
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "design", title: "Issue", details: "x" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("omits the note field from the RE_REVIEW_REQUESTED payload when no opts are given", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.runManualReReview("run-1");

    const reReviewCall = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )!;
    const payload = (reReviewCall[0] as { payloadJson: Record<string, unknown> }).payloadJson;
    expect(payload).toEqual({ from: RunState.AwaitingPlanApproval, to: RunState.PlanReview, trigger: "re-review" });
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no Plan artifact exists for the run", async () => {
    const built = buildDeps(makeRun());
    built.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: transitions back to AwaitingPlanApproval without calling runPlanRevision", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: transitions to PlanRevision and delegates to runPlanRevision with opts.note", async () => {
    const built = buildDeps(makeRun());
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "design", title: "Issue", details: "x" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }) as Run);

    await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });

  it("changes_requested verdict without opts.note: delegates to runPlanRevision with undefined options", async () => {
    const built = buildDeps(makeRun());
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "design", title: "Issue", details: "x" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }) as Run);

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions to Done and posts the completion comment when no distillation agent is configured", async () => {
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Human review approved");
  });

  it("invokes the distillation agent with (runId, run) when configured", async () => {
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), { distillationAgent });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
  });

  it("swallows a non-Error distillation rejection (stringifies it) and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue("llm down") };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), { distillationAgent });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "llm down" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("swallows distillation agent errors (best-effort) and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("llm down")) };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), { distillationAgent });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "llm down" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});
