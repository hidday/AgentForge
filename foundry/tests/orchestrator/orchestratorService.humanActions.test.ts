import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { ValidationError, PolicyError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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
    reviewId: "plan-rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation complete.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: { id: string; runId: string; eventType: string; source: string; payloadJson?: unknown }[];
}

function buildDeps(
  store: TestStore,
  initialRun: Run,
  opts: { agentSkillRepo?: boolean; distillationAgent?: boolean; mainRepoPathDiffersFromWorkingDir?: boolean } = {},
) {
  let eventCounter = 0;

  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(initialRun, patch);
      return Promise.resolve({ ...initialRun, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      eventCounter += 1;
      const evt = { id: `event-${eventCounter}`, ...params };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "desc",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      state: "Todo",
      url: "https://linear.app/x",
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: null, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewVerdict = { current: makePlanReview() };
  const planReviewerAgent = { run: vi.fn().mockImplementation(() => Promise.resolve(planReviewVerdict.current)) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(
      opts.mainRepoPathDiffersFromWorkingDir ? "/repo/main" : initialRun.workingDirectory,
    ),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const agentSkillRepo = opts.agentSkillRepo
    ? {
        findActiveByRepo: vi.fn().mockResolvedValue([]),
        findTopKByRelevance: vi.fn().mockResolvedValue([
          {
            id: "skill-1",
            repoSlug: "test-repo",
            name: "Auth patterns",
            description: "desc",
            taskCategory: "auth",
            skillMarkdown: "# skill",
            utilityScore: 0.5,
            lastUsedAt: new Date(),
          },
        ]),
        incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.6 }),
        incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.4 }),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      }
    : undefined;

  const distillationAgent = opts.distillationAgent
    ? { run: opts.distillationAgent === true ? vi.fn().mockResolvedValue(undefined) : vi.fn() }
    : undefined;

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
      agentSkillRepo,
      distillationAgent,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewVerdict,
    planReviserAgent,
    gitService,
    agentSkillRepo,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment once policy checks pass", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AIReview, prNumber: 42 }));
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.markReady("run-1");

    expect(run).toBeDefined();
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, cleans up the worktree, and updates skill metrics", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] } },
      ],
    };
    const built = buildDeps(
      store,
      makeRun({ state: RunState.ReadyForHumanReview }),
      { agentSkillRepo: true, distillationAgent: true, mainRepoPathDiffersFromWorkingDir: true },
    );
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(built.distillationAgent!.run).toHaveBeenCalledTimes(1);
    expect(run.state).toBe(RunState.Done);
    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/repo/main", "/tmp/worktree");
    expect(built.agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo!.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1", utilityScore: 0.6 });
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
  });

  it("swallows a distillation failure (best-effort) and still completes the run", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun({ state: RunState.ReadyForHumanReview }), {
      distillationAgent: true,
    });
    built.distillationAgent!.run.mockRejectedValue(new Error("distillation blew up"));
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });

  it("skips worktree cleanup when the run's working directory is already the main repo path", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval on an approved verdict", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    built.planReviewVerdict.current = makePlanReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("also returns to AwaitingPlanApproval (not PlanRevision) when changes are requested", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    built.planReviewVerdict.current = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "..." }],
    });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runManualReReview("run-1", { note: "please double check" });

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("transitions to AwaitingPlanApproval directly when the reviewer approves with no changes needed", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    built.planReviewVerdict.current = makePlanReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("revises the plan via runPlanRevision when changes are requested", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    built.planReviewVerdict.current = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "..." }],
    });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.answerQuestions -- error paths and clarification limits", () => {
  function makePlanWithQuestion(): Plan {
    return makePlan({
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
  }

  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded, prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when the TaskBundle artifact is missing after re-planning", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlanWithQuestion() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded, prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("fails the run with CLARIFICATION_EXHAUSTED after MAX_CLARIFICATION_ITERATIONS unresolved rounds", async () => {
    const priorClarificationEvents = Array.from({ length: 3 }, (_, i) => ({
      id: `clarify-${i}`,
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
    }));
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlanWithQuestion() }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: { issue: {}, repo: {}, constraints: {}, definitionOfDone: [] } }),
      ],
      events: priorClarificationEvents,
    };
    const built = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded, prNumber: null }));
    built.deps.plannerAgent.run.mockResolvedValue(makePlanWithQuestion());
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(run.state).toBe(RunState.Failed);
  });

  it("goes back to HumanClarificationNeeded with an incremented iteration count when still under the limit", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlanWithQuestion() }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: { issue: {}, repo: {}, constraints: {}, definitionOfDone: [] } }),
      ],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded, prNumber: null }));
    built.deps.plannerAgent.run.mockResolvedValue(makePlanWithQuestion());
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    const lastCall = built.eventRepo.create.mock.calls.at(-1)?.[0] as {
      eventType: string;
      payloadJson?: { iteration?: number };
    };
    expect(lastCall.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(lastCall.payloadJson?.iteration).toBe(1);
  });

  it("rejects an answer whose questionId isn't on the latest plan", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "does-not-exist", answer: "x" }]),
    ).rejects.toThrow(ValidationError);
  });

  it("throws a PolicyError for a state other than HumanClarificationNeeded/AwaitingPlanApproval", async () => {
    const store: TestStore = { runState: RunState.Implementing, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun({ state: RunState.Implementing, prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(PolicyError);
  });
});
