import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/**
 * Store-backed fake repos: `store.run` is the single source of truth for run
 * state/fields, mutated by updateState()/update(), mirroring how a real DB
 * would behave across a sequence of orchestrator calls within one test.
 */
function buildDeps(store: TestStore, extra: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === store.run.id ? { ...store.run } : null),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      store.run = { ...store.run, ...params };
      return Promise.resolve({ ...store.run });
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
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
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    } as PlanReview),
  };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 42 }),
  };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "review-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "ok" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    } as Remediation),
  };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
      ...extra,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService -- dispatch (handleLinearWebhook / handleCommand)", () => {
  it("handleLinearWebhook: 'issue.created' is a no-op", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" })).resolves.toBeUndefined();
  });

  it("handleLinearWebhook: 'issue.updated' is a no-op", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" })).resolves.toBeUndefined();
  });

  it("handleLinearWebhook: 'comment.command' with a command dispatches to handleCommand", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown", body: "" } as never,
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "unknown", body: "" });
  });

  it("handleLinearWebhook: 'comment.command' without a command does not dispatch", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  describe("handleCommand switch", () => {
    it("'ai-plan' calls startRun", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps } = buildDeps(store);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "startRun").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "ai-plan", body: "" } as never);

      expect(spy).toHaveBeenCalledWith("LIN-1");
    });

    it("'run-ai' calls startRun", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps } = buildDeps(store);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "startRun").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "run-ai", body: "" } as never);

      expect(spy).toHaveBeenCalledWith("LIN-1");
    });

    it("'approve-plan' with an active run calls approvePlan then runExecution", async () => {
      const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(store.run);
      const svc = new OrchestratorService(deps as never);
      const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(store.run);
      const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "approve-plan", body: "" } as never);

      expect(approveSpy).toHaveBeenCalledWith("run-1");
      expect(execSpy).toHaveBeenCalledWith("run-1");
    });

    it("'approve-plan' with no active run does nothing", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "approve-plan", body: "" } as never);

      expect(approveSpy).not.toHaveBeenCalled();
    });

    it("'reject-plan' with an active run calls rejectPlan with the comment body", async () => {
      const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(store.run);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" } as never);

      expect(spy).toHaveBeenCalledWith("run-1", "needs work", "linear");
    });

    it("'reject-plan' with no active run does nothing", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" } as never);

      expect(spy).not.toHaveBeenCalled();
    });

    it("'re-review' with an active run calls runReview", async () => {
      const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(store.run);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "runReview").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "re-review", body: "" } as never);

      expect(spy).toHaveBeenCalledWith("run-1");
    });

    it("'re-review' with no active run does nothing", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "runReview").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "re-review", body: "" } as never);

      expect(spy).not.toHaveBeenCalled();
    });

    it("'pause-ai' with an active run transitions via BLOCKED", async () => {
      const store: TestStore = {
        run: makeRun({ id: "run-1", state: RunState.Planning }),
        artifacts: [],
        events: [],
      };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(store.run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai", body: "" } as never);

      expect(store.run.state).toBe(RunState.AIBlocked);
    });

    it("'pause-ai' with no active run does nothing", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai", body: "" } as never);

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });

    it("'resume-ai' with an active run transitions via RESET_TO_TODO", async () => {
      const store: TestStore = {
        run: makeRun({ id: "run-1", state: RunState.AIBlocked }),
        artifacts: [],
        events: [],
      };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(store.run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai", body: "" } as never);

      expect(store.run.state).toBe(RunState.Todo);
    });

    it("'resume-ai' with no active run does nothing", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, runRepo } = buildDeps(store);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai", body: "" } as never);

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });

    it("'unknown' logs a warning and does nothing else", async () => {
      const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
      const { deps, logger, runRepo } = buildDeps(store);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "unknown", body: "" } as never);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "LIN-1" }),
        "Unknown command received",
      );
      expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    });
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    const store: TestStore = { run: existing, artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("happy path: creates a run, plans with no blocking questions, and delegates to runPlanReview", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
    const { deps, runRepo, plannerAgent } = buildDeps(store);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockImplementation(async () => ({ ...store.run }));

    const result = await svc.startRun("LIN-1");

    expect(runRepo.create).toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(store.run.state).toBe(RunState.PlanReview);
    expect(result.state).toBe(RunState.PlanReview);
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with full replan context (prior plan, rejection, human/researched answers, plan review) and no blockers", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "RejectionContext", version: 1, payloadJson: { planVersion: 1, feedback: "fix it", source: "api", mode: "iterate" } }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: { summary: "s", answers: [{ questionId: "q2", question: "?", answer: "a", confidence: "high" }], completedAt: new Date().toISOString() } }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] } }),
      ],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "fix it" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: expect.objectContaining({ summary: "review summary" }),
      }),
    );
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 }),
      artifacts: [],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Todo, branchName: null }),
      artifacts: [],
      events: [],
    };
    const { deps, gitService, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const { deps, gitService, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when blocking questions remain", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1", state: RunState.Planning }), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("changes_requested verdict transitions and delegates to runPlanRevision", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
    } as PlanReview);
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockImplementation(async () => ({ ...store.run }));

    await svc.runPlanReview("run-1");

    expect(revisionSpy).toHaveBeenCalledWith("run-1");
    expect(store.run.state).toBe(RunState.PlanRevision);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, updates planVersion, transitions to AwaitingPlanApproval, and posts a comment", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { reviewId: "pr-1", summary: "s", findings: [], overallVerdict: "changes_requested" } }),
      ],
      events: [],
    };
    const { deps, planReviserAgent, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
    expect(linearClient.postComment).toHaveBeenCalled();
  });

  it("passes undefined options when no note is given", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { reviewId: "pr-1", summary: "s", findings: [], overallVerdict: "changes_requested" } }),
      ],
      events: [],
    };
    const { deps, planReviserAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approves with an operator note and includes it in the Linear comment", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1", { note: "go ahead" });

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(1);
    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("operator note"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("go ahead");
  });

  it("approves without a note using the plain approval comment", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v1 approved. Starting implementation...",
    );
  });
});

describe("OrchestratorService.runExecution", () => {
  function baseArtifacts() {
    return [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })];
  }

  it("recovers a stranded execution (ExecutionReport exists but EXECUTION_FINISHED never recorded)", async () => {
    const store: TestStore = {
      run: makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 7,
        branchName: "ai/run-1",
      }),
      artifacts: [
        ...baseArtifacts(),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    };
    const { deps, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview").mockImplementation(async () => ({ ...store.run }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(store.run.state).toBe(RunState.AIReview);
  });

  it("happy path: commits WIP checkpoint, runs the executor, and delegates to runReview", async () => {
    const store: TestStore = {
      run: makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
      }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, gitService, executorAgent, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview").mockImplementation(async () => ({ ...store.run }));

    await svc.runExecution("run-1", { note: "be careful" });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalled();
    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: "ai/run-1" }),
      { operatorNote: "be careful" },
    );
    expect(store.run.prNumber).toBe(42);
    expect(store.run.state).toBe(RunState.AIReview);
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(linearClient.postComment).toHaveBeenCalled();
  });

  it("includes a Notes section in the Linear comment when the execution report has notes", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ notes: ["Watch out for flaky test X"] }),
      prNumber: 42,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockImplementation(async () => ({ ...store.run }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("### Notes"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Watch out for flaky test X");
  });

  it("collapses the files-changed list into a <details> block when more than 8 files changed", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 42,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockImplementation(async () => ({ ...store.run }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("<details>"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Files changed (9)");
    expect(comment![1]).toContain("</details>");
  });

  it("skips git checkpointing when the run has no branchName", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, gitService } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockImplementation(async () => ({ ...store.run }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without reviewing", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, executorAgent, linearClient, eventRepo } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AIBlocked);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(comment).toBeDefined();
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      artifacts: baseArtifacts(),
      events: [],
    };
    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});

describe("OrchestratorService.rejectPlan", () => {
  it("'fresh' mode skips loadReplanContext (no previousPlan/humanAnswers injected)", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
    expect(reviewSpy).toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "feedback", "api", "iterate");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runReview", () => {
  it("changes_requested with a PR and findings posts review findings and delegates to runRemediation", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 }),
      artifacts: [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const remediationSpy = vi.spyOn(svc, "runRemediation").mockImplementation(async () => ({ ...store.run }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalled();
    expect(remediationSpy).toHaveBeenCalledWith("run-1", expect.any(Object));
    expect(store.run.state).toBe(RunState.AddressingReview);
  });

  it("approved verdict delegates to markReady", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 }),
      artifacts: [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      ],
      events: [],
    };
    const { deps, reviewerAgent } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockImplementation(async () => ({ ...store.run }));

    await svc.runReview("run-1");

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(store.run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips postReviewFindings when the review has no findings (even though a PR exists)", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 }),
      artifacts: [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockImplementation(async () => ({ ...store.run }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("skips git operations when there is no branchName, and skips GitHub sync when there is no PR", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AddressingReview, branchName: null, prNumber: null }),
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "x", file: "a.ts", title: "t", details: "d" }] }) }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const { deps, gitService, githubSync } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockImplementation(async () => ({ ...store.run }));

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("with a branchName and PR: commits, pushes, and syncs GitHub", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 9 }),
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "x", file: "a.ts", title: "t", details: "d" }] }) }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const { deps, gitService, githubSync } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockImplementation(async () => ({ ...store.run }));

    await svc.runRemediation("run-1", { "f1": 123 });

    expect(gitService.assertBranch).toHaveBeenCalled();
    expect(gitService.commitAndPush).toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      9,
      expect.any(Array),
      { f1: 123 },
    );
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when policy checks pass", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 5 }),
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe("run-1");
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict transitions to AwaitingPlanApproval", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    } as PlanReview);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1", { note: "double check" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict still returns the run to AwaitingPlanApproval (by design)", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "issues",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
    } as PlanReview);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict does not call runPlanRevision", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    } as PlanReview);
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict delegates to runPlanRevision with the operator note", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "issues",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
    } as PlanReview);
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockImplementation(async () => ({ ...store.run }));

    await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(revisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });

  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent, transitions to Done, and cleans up the worktree", async () => {
    const store: TestStore = {
      run: makeRun({
        id: "run-1",
        state: RunState.ReadyForHumanReview,
        workingDirectory: "/tmp/worktree",
      }),
      artifacts: [],
      events: [],
    };
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, gitService, linearClient } = buildDeps(store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(gitService.removeWorktree).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Done"));
  });

  it("continues to Done even when the distillation agent throws (best-effort)", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [],
    };
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation broke")) };
    const { deps, logger } = buildDeps(store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation broke" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("works without a distillationAgent configured at all", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("skips worktree cleanup when the working directory IS the main repo path", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-only" }),
      artifacts: [],
      events: [],
    };
    const { deps, gitService } = buildDeps(store);
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-only");
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle branches (exercised via approvePlan -> runExecution comment path)", () => {
  it("uses the remote default branch when it differs from config, logging a warning", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { reviewId: "pr-1", summary: "s", findings: [], overallVerdict: "changes_requested" } }),
      ],
      events: [],
    };
    const { deps, githubClient, logger, planReviserAgent } = buildDeps(store);
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const bundleArg = planReviserAgent.run.mock.calls[0]?.[2] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("develop");
  });

  it("falls back to the config default branch when GitHub lookup fails", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { reviewId: "pr-1", summary: "s", findings: [], overallVerdict: "changes_requested" } }),
      ],
      events: [],
    };
    const { deps, githubClient, logger, planReviserAgent } = buildDeps(store);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("network error"));
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network error" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    const bundleArg = planReviserAgent.run.mock.calls[0]?.[2] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("main");
  });

  it("includes relatedContext on the bundle when the parent/blockers are present", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: { reviewId: "pr-1", summary: "s", findings: [], overallVerdict: "changes_requested" } }),
      ],
      events: [],
    };
    const { deps, linearClient, planReviserAgent } = buildDeps(store);
    linearClient.getRelatedContext.mockResolvedValue({
      parent: { id: "p1", title: "Parent", description: "", state: "Todo", labels: [], priority: 0 },
      blockers: [],
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    const bundleArg = planReviserAgent.run.mock.calls[0]?.[2] as TaskBundle;
    expect(bundleArg.relatedContext?.parent?.id).toBe("p1");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning / updateSkillMetrics (via startRun + approveHumanReview)", () => {
  it("injects skills and records a SKILL_INJECTION event when skills are found", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", name: "s", description: "d", taskCategory: "t", skillMarkdown: "md", utilityScore: 0.5, lastUsedAt: new Date() },
      ]),
    };
    const { deps, runRepo, plannerAgent, eventRepo } = buildDeps(store, { agentSkillRepo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, runRepo, plannerAgent, eventRepo } = buildDeps(store, { agentSkillRepo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await svc.startRun("LIN-1");

    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeUndefined();
  });

  it("does not attempt skill retrieval when no agentSkillRepo is configured", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
    const { deps, runRepo, plannerAgent } = buildDeps(store);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run }));

    await expect(svc.startRun("LIN-1")).resolves.toBeDefined();
  });

  it("updateSkillMetrics: on Done, increments success for injected skills and archives if low utility", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1", "skill-2"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1"] },
          createdAt: new Date(),
        },
      ],
    };
    const updatedSkill = { id: "skill-1", repoSlug: "test-repo", name: null, description: null, taskCategory: "t", skillMarkdown: "md", utilityScore: 0.1, lastUsedAt: new Date() };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    // De-duplicated across both events: only skill-1 and skill-2, each once.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("updateSkillMetrics: on Failed, increments failure for injected skills", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, workingDirectory: "/tmp" }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }) }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e4", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const failedSkill = { id: "skill-1", repoSlug: "test-repo", name: null, description: null, taskCategory: "t", skillMarkdown: "md", utilityScore: 0.05, lastUsedAt: new Date() };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(failedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, plannerAgent } = buildDeps(store, { agentSkillRepo });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still stuck" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics: logs a warning and continues when a skill update fails", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, logger } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
  });

  it("updateSkillMetrics: no-op when there are no SKILL_INJECTION events", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [],
    };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- edge cases not covered elsewhere", () => {
  it("throws when the run has no TaskBundle artifact after clarification is provided", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }) }),
      ],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded (not Failed) when below the max iteration count", async () => {
    const store: TestStore = {
      run: makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }) }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
      ],
      // Only one prior clarification event -- below MAX_CLARIFICATION_ITERATIONS (3).
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial answer" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService -- requireRun", () => {
  it("throws a descriptive error when the run does not exist", async () => {
    const store: TestStore = { run: makeRun({ id: "run-1" }), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("OrchestratorService -- getters", () => {
  it("expose the underlying repositories and clients", () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps(store, {
      agentSkillRepo: { findTopKByRelevance: vi.fn() },
    });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBeDefined();
  });
});
