import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Test issue",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.Todo,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(executionReport: ExecutionReport, overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport,
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
      workingBranch: "ai/run-1",
      repoPath: "/tmp/worktree",
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
  runFields: Partial<Run>;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeStore(initial: Partial<TestStore> = {}): TestStore {
  return { runState: RunState.Todo, runFields: {}, artifacts: [], events: [], ...initial };
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      store.runFields = { ...store.runFields, ...params };
      store.runState = RunState.Todo;
      return Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState, id: "run-1" });
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runFields, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
      store.runFields = { ...store.runFields, ...data };
      return Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
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
        createdAt: new Date(Date.now() + store.events.length),
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
      branchName: "ai/run-test1",
      labels: [],
      priority: 0,
      project: undefined,
      cycle: undefined,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main"),
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

  // Mimics the real PlannerAgent, which persists the Plan artifact itself;
  // tests that override this with .mockResolvedValue(...) lose this side
  // effect and must seed a matching "Plan" artifact themselves when the
  // flow needs to reach runPlanReview.
  const plannerAgent = {
    run: vi.fn().mockImplementation(
      async (_bundle: TaskBundle, runId: string, opts?: { planVersionOverride?: number }) => {
        const plan = makePlan({ planVersion: opts?.planVersionOverride ?? 1, openQuestions: [] });
        await artifactRepo.create({
          runId,
          type: "Plan",
          version: plan.planVersion,
          payloadJson: plan,
          rawText: JSON.stringify(plan),
        });
        return plan;
      },
    ),
  };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  // Mimics the real ExecutorAgent, which persists the ExecutionReport
  // artifact itself.
  const executorAgent = {
    run: vi.fn().mockImplementation(async (_plan: Plan, _bundle: TaskBundle, runId: string) => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    }),
  };
  // Mimics the real ReviewerAgent, which persists the Review artifact itself.
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async (_plan: Plan, _execReport: ExecutionReport, _diff: string, _bundle: TaskBundle, runId: string) => {
      const review = makeReview();
      await artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    }),
  };
  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, executionReport: ExecutionReport) => {
      const newReport = makeExecutionReport({ executionVersion: executionReport.executionVersion + 1 });
      const remediation = makeRemediation(newReport);
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: newReport.executionVersion,
        payloadJson: newReport,
        rawText: JSON.stringify(newReport),
      });
      await artifactRepo.create({
        runId: "run-1",
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
        rawText: JSON.stringify(remediation),
      });
      return remediation;
    }),
  };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
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

  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
  // Omitted by default (left undefined) so maybeResearchAndReplan's
  // `if (!this.answerResearcherAgent) return` branch is exercised by
  // default; tests that need the researcher pass their own via overrides.

  const deps = {
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
    distillationAgent,
    ...overrides,
  };

  return {
    deps,
    store,
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
    distillationAgent,
  };
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe("OrchestratorService getters", () => {
  it("exposes the injected repositories and clients", () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getLinearClient()).toBe(built.linearClient);
  });

  it("getAgentSkillRepo returns undefined when no agentSkillRepo was injected", () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("getAgentSkillRepo returns the injected repo when provided", () => {
    const store = makeStore();
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const built = buildDeps(store, makeRun(), { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

// ---------------------------------------------------------------------------
// requireRun
// ---------------------------------------------------------------------------

describe("OrchestratorService requireRun (via a public method)", () => {
  it("throws when the run does not exist", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const store = makeStore();
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    const built = buildDeps(store, existing);
    built.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(existing);
    expect(built.runRepo.create).not.toHaveBeenCalled();
    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("happy path with no blocking questions reaches AwaitingPlanApproval via plan review", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(built.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("uses the remote default branch and warns when it differs from the config value", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      expect.stringContaining("defaultBranch differs"),
    );
    const bundlePassed = built.plannerAgent.run.mock.calls[0]?.[0] as TaskBundle;
    expect(bundlePassed.repo.defaultBranch).toBe("trunk");
  });

  it("falls back to the configured default branch when getDefaultBranch throws", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub unavailable"));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub unavailable" }),
      expect.stringContaining("Failed to resolve default branch"),
    );
    const bundlePassed = built.plannerAgent.run.mock.calls[0]?.[0] as TaskBundle;
    expect(bundlePassed.repo.defaultBranch).toBe("main");
  });

  it("injects prior skills and records a SKILL_INJECTION event when agentSkillRepo returns matches", async () => {
    const store = makeStore();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", name: "n", description: "d", taskCategory: "c", skillMarkdown: "m", utilityScore: 0.5, lastUsedAt: new Date() },
      ]),
    };
    const built = buildDeps(store, makeRun({ state: RunState.Todo }), { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
    const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent?.payloadJson as { skillIds: string[] }).skillIds).toEqual(["skill-1"]);
  });

  it("does not inject skills or emit SKILL_INJECTION when agentSkillRepo is not configured", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(store.events.find((e) => e.eventType === "SKILL_INJECTION")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runPlanning
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanning", () => {
  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist", async () => {
    const store = makeStore({ runState: RunState.Planning });
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const built = buildDeps(store, run);

    store.artifacts.push(
      asArtifact({ type: "RejectionContext", version: 2, payloadJson: { planVersion: 2, feedback: "Use OAuth2", source: "api", mode: "iterate" } }),
      asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
      asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: { summary: "s", answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }], completedAt: new Date().toISOString() } }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "needs work", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] } }),
    );
    // Rely on the default plannerAgent.run mock, which persists its own Plan
    // artifact (as the real PlannerAgent does) at the version it's told to
    // use (planVersionOverride), so the subsequent runPlanReview() call
    // (triggered internally) can find it.

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q1" })],
        planReviewFindings: { summary: "needs work", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] },
      }),
    );
  });

  it("omits all optional planner options when no prior artifacts exist", async () => {
    const store = makeStore({ runState: RunState.Planning });
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store, run);
    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    const callArgs = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanFeedback");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store = makeStore({ runState: RunState.Planning });
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store, run);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// retryRun
// ---------------------------------------------------------------------------

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const store = makeStore({ runState: RunState.Todo });
    const run = makeRun({ state: RunState.Todo, branchName: null, workingDirectory: "/tmp/main" });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main",
      "run-1",
      "main",
      "ai/run-test1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("does not set up a worktree when the run already has a branchName", async () => {
    const store = makeStore({ runState: RunState.Todo });
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("falls back to repoRegistry.getDefaultRepo when getRepoByName returns nothing", async () => {
    const store = makeStore({ runState: RunState.Todo });
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(store, run);
    built.repoRegistry.getRepoByName.mockReturnValue(undefined);

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("pauses for human clarification when the new plan has blocking questions", async () => {
    const store = makeStore({ runState: RunState.Todo });
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const built = buildDeps(store, run);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

// ---------------------------------------------------------------------------
// runPlanReview / runPlanRevision
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const store = makeStore({ runState: RunState.PlanReview });
    const built = buildDeps(store, makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict moves to AwaitingPlanApproval and posts the plan summary", async () => {
    const store = makeStore({ runState: RunState.PlanReview });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store, makeRun({ state: RunState.PlanReview }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("changes_requested verdict chains into plan revision and ends in AwaitingPlanApproval", async () => {
    const store = makeStore({ runState: RunState.PlanReview });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store, makeRun({ state: RunState.PlanReview }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Fix this", details: "d" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comments = built.linearClient.postComment.mock.calls.map((c: unknown[]) => c[1]);
    expect(comments.some((c) => typeof c === "string" && c.includes("Changes Requested"))).toBe(true);
    expect(comments.some((c) => typeof c === "string" && c.includes("Plan Revision Dispositions"))).toBe(true);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes operatorNote through to planReviserAgent when opts.note is given", async () => {
    const store = makeStore({ runState: RunState.PlanRevision });
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: { overallVerdict: "changes_requested", summary: "s", findings: [] } }),
    );
    const built = buildDeps(store, makeRun({ state: RunState.PlanRevision }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1", { note: "please hurry" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please hurry" },
    );
  });

  it("passes undefined options when no note is given", async () => {
    const store = makeStore({ runState: RunState.PlanRevision });
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: { overallVerdict: "changes_requested", summary: "s", findings: [] } }),
    );
    const built = buildDeps(store, makeRun({ state: RunState.PlanRevision }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

// ---------------------------------------------------------------------------
// approvePlan
// ---------------------------------------------------------------------------

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approvePlan("run-1", { note: "go ahead" });

    expect(result.state).toBe(RunState.Implementing);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("go ahead"),
    );
  });

  it("posts a generic approval comment when no note is given", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.approvePlan("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringMatching(/^Plan v1 approved\. Starting implementation\.\.\.$/),
    );
  });
});

// ---------------------------------------------------------------------------
// runExecution
// ---------------------------------------------------------------------------

describe("OrchestratorService.runExecution", () => {
  function seedPlanForExecution(store: TestStore) {
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }));
  }

  it("happy path commits a checkpoint, runs the executor, and chains into review", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", approvedPlanVersion: 1 });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(built.executorAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the checkpoint commit when the run has no branchName", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    const run = makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("transitions to AIBlocked and posts a comment when the executor times out", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps(store, run);
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(store.events.some((e) => e.eventType === "EXECUTION_TIMEOUT")).toBe(true);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps(store, run);
    built.executorAgent.run.mockRejectedValue(new Error("unexpected crash"));

    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("unexpected crash");
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    store.artifacts.push(
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    store.events.push({
      id: "ev-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(Date.now() - 10_000),
    });
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 42 });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(store.events.some((e) => e.eventType === RunEvent.EXECUTION_FINISHED)).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not take the recovery path when the run has no prNumber yet", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    seedPlanForExecution(store);
    store.artifacts.push(
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: null });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalled();
  });

  it("throws a PolicyViolationError when the executor touches a protected path", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    store.artifacts.push(
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ planVersion: 1 }),
      }),
    );
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps(store, run);
    built.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/key.txt"] }),
      prNumber: 42,
    });

    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(store.events.some((e) => e.eventType === RunEvent.EXECUTION_FINISHED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runReview
// ---------------------------------------------------------------------------

describe("OrchestratorService.runReview", () => {
  function seedForReview(store: TestStore, executionReport: ExecutionReport, plan: Plan = makePlan()) {
    store.artifacts.push(
      asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }),
      asArtifact({ type: "ExecutionReport", version: executionReport.executionVersion, payloadJson: executionReport }),
    );
  }

  it("approved verdict transitions through markReady to ReadyForHumanReview", async () => {
    const store = makeStore({ runState: RunState.AIReview });
    seedForReview(store, makeExecutionReport());
    const run = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("changes_requested with findings posts them to GitHub and feeds the comment map into remediation", async () => {
    const store = makeStore({ runState: RunState.AIReview });
    const execReport = makeExecutionReport();
    seedForReview(store, execReport);
    const changesReview = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "d" }],
    });
    // Pre-seed the Review artifact the (mocked) reviewer agent would have written,
    // so assertCanRemediate finds it via findLatestByType.
    store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: changesReview }));
    const run = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, run);
    built.reviewerAgent.run.mockResolvedValue(changesReview);
    built.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));

    const svc = new OrchestratorService(built.deps as never);

    // markReady at the end of runRemediation hits the known pre-existing limitation
    // that remediation doesn't itself produce an "approved" Review (see
    // orchestratorService.executionScore.test.ts) -- we assert on everything that
    // happens before that policy violation.
    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      changesReview.findings,
      "changes_requested",
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 101 },
    );
    expect(store.events.some((e) => e.eventType === RunEvent.REVIEW_CHANGES_REQUESTED)).toBe(true);
  });

  it("skips posting review findings when the reviewer returns no findings, and surfaces the missing-review policy error", async () => {
    const store = makeStore({ runState: RunState.AIReview });
    seedForReview(store, makeExecutionReport());
    const run = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, run);
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));

    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("remediate_requires_review");
  });
});

// ---------------------------------------------------------------------------
// runRemediation (branches not covered by orchestratorService.executionScore.test.ts)
// ---------------------------------------------------------------------------

describe("OrchestratorService.runRemediation branchless-run behaviour", () => {
  it("skips git operations and GitHub PR updates when the run has no branchName or PR", async () => {
    const store = makeStore({ runState: RunState.AddressingReview });
    const execReport = makeExecutionReport();
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: execReport }),
      asArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "changes_requested",
          findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
        }),
      }),
    );
    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    // markReady still fails (no PR) -- a different, expected policy violation --
    // but the branch/PR-conditional side effects should have been skipped.
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_pr");
    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markReady
// ---------------------------------------------------------------------------

describe("OrchestratorService.markReady", () => {
  it("posts the ready-for-review comment when all policy checks pass", async () => {
    const store = makeStore({ runState: RunState.AIReview });
    store.artifacts.push(
      asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps(store, run);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.markReady("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runManualReReview
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualReReview", () => {
  it("passes the operator note through and returns to AwaitingPlanApproval on approval", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.planReviewerAgent.run.mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "s", findings: [] });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when changes are requested", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "s",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runManualPlanRevision
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays at AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.planReviewerAgent.run.mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "s", findings: [] });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("revises the plan (carrying the operator note) when changes are requested", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: { overallVerdict: "changes_requested", summary: "s", findings: [] } }),
    );
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "s",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

// ---------------------------------------------------------------------------
// approveHumanReview, cleanupRunWorktree, updateSkillMetrics
// ---------------------------------------------------------------------------

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, approves, and cleans up a worktree that differs from the main repo path", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    const built = buildDeps(store, run);
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(built.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("does not remove the worktree when it is already the main repo path", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main" });
    const built = buildDeps(store, run);
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("proceeds to Done even when there is no distillationAgent configured", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store, run, { distillationAgent: undefined });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation failure (logs a warning) and still completes the run", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store, run);
    built.distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      expect.stringContaining("Distillation agent failed"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("increments skill success metrics for every distinct skill injected across the run's lifetime", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    store.events.push(
      {
        id: "ev1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
        createdAt: new Date(),
      },
      {
        id: "ev2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-b"] },
        createdAt: new Date(),
      },
    );
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const incrementedSkill = { id: "skill-a", successCount: 1, failureCount: 0, utilityScore: 0.5 };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(incrementedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps(store, run, { agentSkillRepo });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual([
      "skill-a",
      "skill-b",
    ]);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("logs a warning and continues when incrementing a skill metric fails", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    store.events.push({
      id: "ev1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a"] },
      createdAt: new Date(),
    });
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps(store, run, { agentSkillRepo });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "db down" }),
      expect.stringContaining("Failed to update skill metric"),
    );
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.Done);
  });

  it("does not touch skill metrics when there were no SKILL_INJECTION events", async () => {
    const store = makeStore({ runState: RunState.ReadyForHumanReview });
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps(store, run, { agentSkillRepo });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});
