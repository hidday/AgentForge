import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
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

function asArtifact(o: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
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
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff"), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/.worktrees/run-1", branchName: "ai/run-1" }),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    reviewerAgent,
  };
}

describe("OrchestratorService -- maybeResearchAndReplan's humanAnswers branches", () => {
  it("threads prior HumanAnswers into both the answer researcher and the re-planner call", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q0", answer: "prior answer" }] },
        }),
      ],
      events: [],
    };
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        completedAt: new Date().toISOString(),
        answers: [{ questionId: "q1", question: "q1?", answer: "a1", confidence: "high" as const }],
      }),
    };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, { answerResearcherAgent });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    let call = 0;
    plannerAgent.run.mockImplementation((_bundle: unknown, _runId: string, opts?: Record<string, unknown>) => {
      call++;
      if (call === 1) {
        const p = makePlan({
          planVersion: 1,
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
        });
        store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: p }));
        return Promise.resolve(p);
      }
      const p2 = makePlan({
        planVersion: (opts?.planVersionOverride as number) ?? 2,
        openQuestions: [],
      });
      store.artifacts.push(asArtifact({ type: "Plan", version: p2.planVersion, payloadJson: p2 }));
      return Promise.resolve(p2);
    });

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q0", answer: "prior answer" }] },
    );
    // Second plannerAgent.run call (the re-plan after research) should also carry humanAnswers.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q0", answer: "prior answer" }] }),
    );
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning query building", () => {
  it("includes the run's linearIssueDescription (truncated) in the relevance query when present", async () => {
    const store: Store = {
      run: makeRun({ linearIssueDescription: "A fairly detailed description of the bug." }),
      artifacts: [],
      events: [],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, { agentSkillRepo });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    plannerAgent.run.mockImplementation((_bundle: unknown, _runId: string, opts?: Record<string, unknown>) => {
      const p = makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] });
      store.artifacts.push(asArtifact({ type: "Plan", version: p.planVersion, payloadJson: p }));
      return Promise.resolve(p);
    });
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("A fairly detailed description of the bug."),
      expect.any(Number),
    );
  });
});

describe("OrchestratorService -- formatPlanComment risks section", () => {
  it("includes a Risks section in the posted comment when the approved plan has risks", async () => {
    const plan = makePlan({ planVersion: 1, risks: ["Might break the login flow"] });
    const store: Store = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, linearClient } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Might break the login flow"),
    );
  });
});

describe("OrchestratorService -- formatPlanReviewComment affectedStepId", () => {
  it("includes the affected step id in the finding line when the plan reviewer flags one", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent, linearClient } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [
        { id: "f1", severity: "important", type: "x", title: "Unsafe step", details: "d", affectedStepId: "s1" },
      ],
      overallVerdict: "changes_requested",
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("(step s1)"),
    );
  });
});

describe("OrchestratorService -- formatCodeReviewComment lineHint", () => {
  it("includes the line hint in the finding line when the code reviewer provides one", async () => {
    const report = {
      executionVersion: 1,
      summary: "done",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass" as const, details: "ok" },
        typecheck: { status: "pass" as const, details: "ok" },
        tests: { status: "pass" as const, details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "ok",
    };
    const store: Store = {
      run: makeRun({ state: RunState.AIReview }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, linearClient } = buildDeps(store);
    reviewerAgent.run.mockImplementation(() => {
      const review = {
        reviewId: "r1",
        summary: "Found a line-level issue",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", lineHint: 42, title: "Off by one", details: "d" },
        ],
        overallVerdict: "changes_requested",
      };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });
    (deps.remediationAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      reviewId: "r1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "real bug" }],
      readyForHumanReview: true,
      executionReport: report,
    });
    const svc = new OrchestratorService(deps as never);

    // remediation/markReady failing beyond this point is out of scope (see
    // orchestratorService.runReview.test.ts); we only need the comment that
    // is posted immediately after the changes_requested transition.
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("src/foo.ts:42"),
    );
  });
});
