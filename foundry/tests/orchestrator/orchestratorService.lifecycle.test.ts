import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { PlanRevision } from "../../src/schemas/planRevision.js";

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
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
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
    summary: "Needs work",
    findings: [
      {
        id: "pf1",
        severity: "important",
        type: "gap",
        title: "Missing step",
        details: "details",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

const defaultIssue = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "Test description",
  url: "https://linear.app/x",
  branchName: "ai/lin-1",
  labels: [] as string[],
  priority: 0,
};

const defaultRepoEntry = {
  name: "test-repo",
  defaultBranch: "main",
  allowedPaths: ["src/"],
  protectedPaths: [] as string[],
  constraints: {
    requiredChecks: [] as string[],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [] as string[],
    mustNotTouch: [] as string[],
  },
};

/** Build a full deps object with a stateful runRepo tracking state across
 *  possibly-multiple transitionAndRecord calls within one flow, and an
 *  artifactRepo backed by `artifacts` for findLatestByType lookups. */
function buildDeps(initialRun: Run, artifacts: Artifact[] = []) {
  let trackedState = initialRun.state;
  let trackedPlanVersion = initialRun.planVersion;
  let trackedApproved = initialRun.approvedPlanVersion;
  let trackedPrNumber = initialRun.prNumber;

  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({
        ...initialRun,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
      }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      trackedState = newState;
      return Promise.resolve({
        ...initialRun,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
      });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      if (patch.planVersion !== undefined) trackedPlanVersion = patch.planVersion;
      if (patch.approvedPlanVersion !== undefined) trackedApproved = patch.approvedPlanVersion;
      if (patch.prNumber !== undefined) trackedPrNumber = patch.prNumber;
      return Promise.resolve({
        ...initialRun,
        ...patch,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
      });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      const a = asArtifact({
        type: params.type as string,
        version: params.version as number,
        payloadJson: params.payloadJson,
      });
      artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(defaultIssue),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      logger,
      dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with prior context (rejection, human answers, researched answers, plan review findings) when all are present, and proceeds to plan review when no blockers remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const rejection: RejectionContextPayload = {
      planVersion: 1,
      feedback: "please fix X",
      source: "api",
      mode: "iterate",
    };
    const prevPlan = makePlan({ planVersion: 1 });
    const artifacts: Artifact[] = [
      asArtifact({ type: "RejectionContext", version: 1, payloadJson: rejection }),
      asArtifact({ type: "Plan", version: 1, payloadJson: prevPlan }),
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
      asArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          completedAt: new Date().toISOString(),
          answers: [{ questionId: "q1", question: "Q1?", answer: "A1", confidence: "high" }],
        },
      }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "review summary", findings: [] },
      }),
    ];
    const built = buildDeps(run, artifacts);
    const svc = new OrchestratorService(built.deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run.mockResolvedValue(newPlan);
    const planReviewApproved: PlanReview = {
      reviewId: "pr-x",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    };
    built.planReviewerAgent.run.mockImplementation(async (plan: Plan, _bundle, runId: string) => {
      built.artifactRepo.create({
        runId,
        type: "PlanReview",
        version: plan.planVersion,
        payloadJson: planReviewApproved,
        rawText: "",
      });
      return planReviewApproved;
    });

    const result = await svc.runPlanning(run.id);

    expect(built.plannerAgent.run).toHaveBeenCalledTimes(1);
    const callOpts = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOpts.planVersionOverride).toBe(2);
    expect(callOpts.previousPlan).toEqual(prevPlan);
    expect(callOpts.humanFeedback).toEqual({ planVersion: 1, feedback: "please fix X" });
    expect(callOpts.humanAnswers).toEqual([{ questionId: "q1", answer: "yes" }]);
    expect(callOpts.researchedAnswers).toEqual([
      { questionId: "q1", question: "Q1?", answer: "A1", confidence: "high" },
    ]);
    expect(callOpts.planReviewFindings).toEqual({ summary: "review summary", findings: [] });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("re-plans with none of the optional prior-context fields when no such artifacts exist, and pauses for clarification when blockers remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 3 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    const blockingPlan = makePlan({
      planVersion: 4,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    built.plannerAgent.run.mockResolvedValue(blockingPlan);

    const result = await svc.runPlanning(run.id);

    const callOpts = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOpts.planVersionOverride).toBe(4);
    expect(callOpts.previousPlan).toBeUndefined();
    expect(callOpts.humanFeedback).toBeUndefined();
    expect(callOpts.humanAnswers).toBeUndefined();
    expect(callOpts.researchedAnswers).toBeUndefined();
    expect(callOpts.planReviewFindings).toBeUndefined();

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName, then proceeds to plan review", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async (_bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.retryRun(run.id);

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      run.id,
      "main",
      "ai/lin-1",
    );
    expect(built.runRepo.update).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("does NOT set up a new worktree when the run already has a branchName, and pauses on blocking questions", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 2 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun(run.id);

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview -- changes requested path", () => {
  it("transitions to PlanRevision when the reviewer requests changes, then delegates to runPlanRevision", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const artifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: plan })];
    const built = buildDeps(run, artifacts);
    const svc = new OrchestratorService(built.deps as never);

    const planReview = makePlanReview();
    built.planReviewerAgent.run.mockImplementation(async (_plan: Plan, _bundle, runId: string) => {
      // Mirror the real PlanReviewerAgent, which persists its own output as
      // a PlanReview artifact; runPlanRevision reads it back.
      await built.artifactRepo.create({
        runId,
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: "",
      });
      return planReview;
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    const revision: PlanRevision = {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: planReview.reviewId,
      dispositions: [{ findingId: "pf1", status: "accepted", rationale: "fair point" }],
    };
    built.planReviserAgent.run.mockResolvedValue({ revision, revisedPlan });

    const result = await svc.runPlanReview(run.id);

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      run.id,
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalled();
    const lastComment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(lastComment).toContain("Plan Revision Dispositions");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes an operatorNote through to the plan reviser when opts.note is supplied", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview();
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
    ];
    const built = buildDeps(run, artifacts);
    const svc = new OrchestratorService(built.deps as never);

    const revisedPlan = makePlan({ planVersion: 2 });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: planReview.reviewId,
        dispositions: [],
      },
      revisedPlan,
    });

    await svc.runPlanRevision(run.id, { note: "please double-check edge cases" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      run.id,
      { operatorNote: "please double-check edge cases" },
    );
  });

  it("passes undefined options to the plan reviser when no note is supplied", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview();
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
    ];
    const built = buildDeps(run, artifacts);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: planReview.reviewId,
        dispositions: [],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision(run.id);

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      run.id,
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("approves the latest plan version, records approvedPlanVersion, and posts a plain comment when no note is given", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 2, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan(run.id);

    expect(built.runRepo.update).toHaveBeenCalledWith(run.id, { approvedPlanVersion: 2 });
    expect(result.state).toBe(RunState.Implementing);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan(run.id, { note: "ship it fast" });

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("ship it fast"),
    );
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan(run.id)).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runManualReReview(run.id, { note: "quick check" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      run.id,
      { operatorNote: "quick check" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const result = await svc.runManualReReview(run.id);

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), run.id, undefined);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview(run.id)).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("when the reviewer approves, stays at AwaitingPlanApproval without revising", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runManualPlanRevision(run.id);

    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("when the reviewer requests changes, revises the plan via runPlanRevision", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview();
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockImplementation(async (_plan: Plan, _bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: "",
      });
      return planReview;
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: planReview.reviewId,
        dispositions: [],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision(run.id, { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      run.id,
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.rejectPlan -- fresh mode and post-rejection blocking", () => {
  it("in 'fresh' mode, does not load prior plan/answers context (only feedback is forwarded)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const prevPlan = makePlan({ planVersion: 1 });
    const artifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: prevPlan })];
    const built = buildDeps(run, artifacts);
    const svc = new OrchestratorService(built.deps as never);

    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.rejectPlan(run.id, "start over please", "api", "fresh");

    const callOpts = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    // previousPlan/humanAnswers/researchedAnswers/planReviewFindings all come from
    // loadReplanContext, which is only invoked in "iterate" mode.
    expect(callOpts.previousPlan).toBeUndefined();
    expect(callOpts.humanAnswers).toBeUndefined();
    expect(callOpts.researchedAnswers).toBeUndefined();
    expect(callOpts.planReviewFindings).toBeUndefined();
    // The RejectionContext artifact (feedback) is still forwarded regardless of mode.
    expect(callOpts.humanFeedback).toEqual({ planVersion: 1, feedback: "start over please" });
  });

  it("pauses for clarification when the re-plan after rejection still has blocking questions", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which API key?", requiredForExecution: true }],
      }),
    );

    const result = await svc.rejectPlan(run.id, "needs more detail", "api", "iterate");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
