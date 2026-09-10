import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
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
  };
}

function asArtifact(overrides: {
  type: Artifact["type"];
  version: number;
  payloadJson: unknown;
}): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type,
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  let current: Run = makeRun();

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      current = { ...current, state: newState };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

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
      distillationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    setRun: (run: Run) => {
      current = run;
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    planReviewerAgent,
    planReviserAgent,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("throws StateTransitionError when the run is not in AwaitingPlanApproval", async () => {
    const { deps, setRun } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.Implementing }));

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(StateTransitionError);
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, setRun, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("passes opts.note through as operatorNote to planReviewerAgent.run, and records it on the RE_REVIEW_REQUESTED event", async () => {
    const { deps, setRun, artifactRepo, eventRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: plan })) : Promise.resolve(null),
    );

    await svc.runManualReReview("run-1", { note: "please double-check auth" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "please double-check auth" },
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.RE_REVIEW_REQUESTED,
        payloadJson: expect.objectContaining({ trigger: "re-review", note: "please double-check auth" }),
      }),
    );
  });

  it("calls planReviewerAgent.run without operatorNote when no note is given", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: plan })) : Promise.resolve(null),
    );

    await svc.runManualReReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
  });

  it("always returns to AwaitingPlanApproval when the verdict is approved", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("always returns to AwaitingPlanApproval (not PlanRevision) even when the verdict is changes_requested", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", title: "Issue", details: "x" },
        ],
      }),
    );

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // Manual re-review never auto-chains into plan revision.
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws StateTransitionError when the run is not in AwaitingPlanApproval", async () => {
    const { deps, setRun } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.Implementing }));

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(StateTransitionError);
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, setRun, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("when approved: transitions to AwaitingPlanApproval and does NOT trigger a revision", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("when changes_requested: transitions through PlanRevision, delegates to runPlanRevision with the note, and ends AwaitingPlanApproval", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());

    const plan = makePlan();
    const planReview = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "x" }],
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);

    const revisedPlan = makePlan({ planVersion: 3 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed" }] },
      revisedPlan,
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "focus on tests" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on tests" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(3);

    const comments = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[1] as string,
    );
    expect(comments.some((c) => c.includes("Revised after AI review"))).toBe(true);
  });

  it("passes undefined (not an empty note object) to runPlanRevision when no note was given", async () => {
    const { deps, setRun, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun());

    const plan = makePlan();
    const planReview = makePlanReview({ overallVerdict: "changes_requested", findings: [] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("throws StateTransitionError when the run is not in ReadyForHumanReview", async () => {
    const { deps, setRun } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.AIReview }));

    await expect(svc.approveHumanReview("run-1")).rejects.toThrow(StateTransitionError);
  });

  it("transitions to Done, posts the completion comment, and cleans up the worktree", async () => {
    const { deps, setRun, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/worktrees/run-1" }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    // cleanupRunWorktree removes the worktree once the run reaches Done
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/worktrees/run-1");
  });

  it("invokes the distillation agent with the run before transitioning", async () => {
    const { deps, setRun, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    setRun(run);

    await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
  });

  it("swallows distillation agent errors (best-effort) and still completes the run", async () => {
    const { deps, setRun, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));
    distillationAgent.run.mockRejectedValue(new Error("distillation boom"));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("swallows a non-Error rejection from the distillation agent by stringifying it", async () => {
    const { deps, setRun, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));
    distillationAgent.run.mockRejectedValue("weird non-error rejection");

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "weird non-error rejection" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("works fine when no distillationAgent is configured", async () => {
    const { deps, setRun } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
