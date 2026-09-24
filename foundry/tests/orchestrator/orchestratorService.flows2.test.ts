import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Remediation } from "../../src/schemas/remediation.js";

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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Plan looks solid",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random().toString(36).slice(2)}`,
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

function buildHarness(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: TestStore = { run: initialRun, artifacts: [...initialArtifacts], events: [] };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      eventType: string;
      source: string;
      payloadJson?: unknown;
    }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length}`,
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/foo b/foo"),
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

  // Mirrors the real PlannerAgent: persists a Plan artifact as a side effect
  // of run() so downstream findLatestByType(runId, "Plan") lookups succeed.
  const plannerAgent = {
    run: vi.fn().mockImplementation(async (_bundle: unknown, runId: string, options?: { planVersionOverride?: number }) => {
      const plan = makePlan({ planVersion: options?.planVersionOverride ?? 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    }),
  };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  // Mirrors the real ExecutorAgent: persists an ExecutionReport artifact as a
  // side effect of run().
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      const report = makeExecutionReport();
      store.artifacts.push(
        asArtifact({ type: "ExecutionReport", version: report.executionVersion, payloadJson: report }),
      );
      return { report, prNumber: 101 };
    }),
  };
  // Mirrors the real ReviewerAgent: persists a Review artifact as a side
  // effect of run().
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview();
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    }),
  };
  const remediationAgent = { run: vi.fn().mockResolvedValue(makeRemediation()) };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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

  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.5 }),
    incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.1 }),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };

  return {
    store,
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
      answerResearcherAgent: undefined as { run: ReturnType<typeof vi.fn> } | undefined,
      logger,
      dashboardEmitter,
      agentSkillRepo,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    linearSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    distillationAgent,
    gitService,
    logger,
    dashboardEmitter,
    agentSkillRepo,
    repoRegistry,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without re-planning when one already exists for the issue", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    const h = buildHarness(makeRun());
    h.runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(existing);
    expect(h.linearClient.getIssue).not.toHaveBeenCalled();
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const h = buildHarness(makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("changes_requested verdict: posts the plan-review comment and delegates to runPlanRevision", async () => {
    const h = buildHarness(makeRun({ state: RunState.PlanReview }), [
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          risks: ["Might break prod"],
          openQuestions: [{ id: "q1", question: "Non-blocking?", requiredForExecution: false }],
        }),
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "gap",
            affectedStepId: "s1",
            title: "Missing rollback",
            details: "No rollback plan",
          },
        ],
      }),
    );

    const result = await svc.runPlanReview("run-1");

    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Plan Review -- Changes Requested"),
    );
    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.rejectPlan blocking questions", () => {
  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });
      h.store.artifacts.push(asArtifact({ type: "Plan", version: 2, payloadJson: plan }));
      return plan;
    });

    const result = await svc.rejectPlan("run-1", "please reconsider", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("does not re-create the TaskBundle artifact when one already exists", async () => {
    const bundlePayload = {
      issue: { id: "LIN-1", title: "x", description: "y", labels: [], priority: 0 },
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
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: bundlePayload }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.rejectPlan("run-1");

    const taskBundleCreateCalls = h.artifactRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCreateCalls).toHaveLength(0);
  });
});

describe("OrchestratorService.runRemediation success path", () => {
  it("completes and returns the run when the downstream markReady preconditions are satisfied", async () => {
    const h = buildHarness(
      makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 77 }),
      [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
        asArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({
            overallVerdict: "changes_requested",
            findings: [
              {
                id: "f1",
                severity: "important",
                type: "bug",
                file: "src/foo.ts",
                title: "Bug",
                details: "d",
              },
            ],
          }),
        }),
      ],
    );
    const svc = new OrchestratorService(h.deps as never);

    // The mocked RemediationAgent, like the real one, writes a fresh
    // ExecutionReport; unlike the real one it also re-approves the review so
    // this test can reach runRemediation's successful completion (line
    // `return run;`), matching a scenario where a human or a later review
    // cycle has already re-approved the PR before remediation runs.
    h.remediationAgent.run.mockImplementation(async () => {
      const remediation = makeRemediation();
      h.store.artifacts.push(
        asArtifact({
          type: "ExecutionReport",
          version: remediation.executionReport.executionVersion,
          payloadJson: remediation.executionReport,
        }),
      );
      h.store.artifacts.push(
        asArtifact({
          type: "Review",
          version: 2,
          payloadJson: makeReview({ overallVerdict: "approved", findings: [] }),
        }),
      );
      return remediation;
    });

    const result = await svc.runRemediation("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });
});

describe("OrchestratorService.answerQuestions edge cases", () => {
  it("throws a generic Error when no Plan artifact exists", async () => {
    const h = buildHarness(makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(h.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws a generic Error when the TaskBundle artifact is missing during re-planning", async () => {
    const h = buildHarness(makeRun({ state: RunState.HumanClarificationNeeded }), [
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
        }),
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("loops back to HumanClarificationNeeded with an incremented iteration when blockers remain but max iterations is not yet reached", async () => {
    const bundlePayload = {
      issue: { id: "LIN-1", title: "x", description: "y", labels: [], priority: 0 },
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
    const h = buildHarness(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }), [
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
        }),
      }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: bundlePayload }),
    ]);
    // One prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    h.store.events.push({
      id: "evt-prior",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(h.deps as never);
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      });
      h.store.artifacts.push(asArtifact({ type: "Plan", version: 2, payloadJson: plan }));
      return plan;
    });

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "unclear" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const secondClarification = h.store.events.filter(
      (e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(secondClarification).toHaveLength(2);
    expect((secondClarification[1].payloadJson as { iteration: number }).iteration).toBe(2);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions to AwaitingPlanApproval", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval without auto-chaining into revision", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            title: "Nit",
            details: "d",
          },
        ],
      }),
    );

    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
    expect(h.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval without revising", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: revises the plan via runPlanRevision", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "d" }],
      }),
    );

    const result = await svc.runManualPlanRevision("run-1", { note: "simplify" });

    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(h.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("skips distillation gracefully when distillationAgent is not injected", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    (h.deps as { distillationAgent?: unknown }).distillationAgent = undefined;
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("catches and logs a warning when distillationAgent.run throws, without failing the approval", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    h.distillationAgent.run.mockRejectedValue(new Error("distillation exploded"));
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation exploded" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});

describe("OrchestratorService worktree cleanup and skill metrics on terminal transitions", () => {
  it("removes the worktree and updates skill metrics (success) when the run reaches Done", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }));
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    // A prior SKILL_INJECTION event records which skills were injected during planning.
    h.store.events.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(h.deps as never);

    await svc.approveHumanReview("run-1");

    expect(h.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("does not attempt worktree removal when workingDirectory already equals the main repo path", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" }));
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    const svc = new OrchestratorService(h.deps as never);

    await svc.approveHumanReview("run-1");

    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("updates skill metrics with failure increments and logs a warning when a metric update throws, on a run reaching Failed", async () => {
    const h = buildHarness(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }), [
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
        }),
      }),
      asArtifact({
        type: "TaskBundle",
        version: 1,
        payloadJson: {
          issue: { id: "LIN-1", title: "x", description: "y", labels: [], priority: 0 },
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
        },
      }),
    ]);
    h.store.events.push(
      {
        id: "evt-c1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
      {
        id: "evt-c2",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
      {
        id: "evt-c3",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
      {
        id: "evt-injection",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    );
    h.agentSkillRepo.incrementFailure.mockRejectedValue(new Error("db down"));
    // Re-plan still has the same blocking question, so with 3 prior
    // NEEDS_HUMAN_CLARIFICATION events already recorded, this answer push
    // will exhaust MAX_CLARIFICATION_ITERATIONS and fail the run.
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      });
      h.store.artifacts.push(asArtifact({ type: "Plan", version: 2, payloadJson: plan }));
      return plan;
    });
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning", () => {
  it("records a SKILL_INJECTION event when relevant skills are found", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo }));
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "auth-middleware",
        description: "d",
        taskCategory: "auth",
        skillMarkdown: "md",
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
    ]);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.startRun("LIN-1");

    const injectionEvent = h.store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent!.payloadJson as { skillIds: string[] }).skillIds).toEqual(["skill-1"]);
  });

  it("does NOT record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo }));
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.startRun("LIN-1");

    const injectionEvent = h.store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeUndefined();
  });
});

describe("OrchestratorService.maybeResearchAndReplan humanAnswers passthrough", () => {
  it("includes prior humanAnswers in the post-research re-plan call when a HumanAnswers artifact exists", async () => {
    const h = buildHarness(makeRun({ state: RunState.Planning, planVersion: 1 }), [
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "Use Postgres" }] },
      }),
    ]);
    h.deps.answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "Researched.",
        answers: [
          {
            questionId: "q2",
            question: "Optional?",
            answer: "Sure",
            confidence: "high" as const,
            sources: [],
          },
        ],
        completedAt: new Date().toISOString(),
      }),
    };
    const svc = new OrchestratorService(h.deps as never);

    let planCallCount = 0;
    h.plannerAgent.run.mockImplementation(async (_bundle: unknown, runId: string, options?: { planVersionOverride?: number }) => {
      planCallCount += 1;
      const plan =
        planCallCount === 1
          ? makePlan({
              planVersion: 1,
              openQuestions: [{ id: "q2", question: "Optional?", requiredForExecution: false }],
            })
          : makePlan({ planVersion: options?.planVersionOverride ?? 2, openQuestions: [] });
      h.store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    });

    await svc.runPlanning("run-1");

    // Second plannerAgent.run call is the post-research re-plan; it must carry
    // forward the previously-submitted human answers.
    expect(h.plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(h.plannerAgent.run.mock.calls[1][2]).toMatchObject({
      humanAnswers: [{ questionId: "q1", answer: "Use Postgres" }],
    });
  });
});

describe("OrchestratorService.rejectPlan loadReplanContext (iterate mode)", () => {
  it("passes previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from prior artifacts", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }), [
      asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
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
          answers: [
            { questionId: "q2", question: "Q?", answer: "A", confidence: "medium" as const },
          ],
        },
      }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "review summary", findings: [] },
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.rejectPlan("run-1", "please redo this", "api", "iterate");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
  });

  it("only passes feedback (no prior context) in fresh mode", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }), [
      asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ humanAnswers: expect.anything() }),
    );
  });
});

describe("OrchestratorService.buildTaskBundle default-branch resolution", () => {
  it("uses the remote default branch and warns when it differs from the configured one", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo }));
    h.githubClient.getDefaultBranch.mockResolvedValue("develop");
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.startRun("LIN-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "develop" }) }),
      "run-1",
      expect.anything(),
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the configured default branch and warns when the GitHub lookup throws", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo }));
    h.githubClient.getDefaultBranch.mockRejectedValue(new Error("rate limited"));
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.startRun("LIN-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
      "run-1",
      expect.anything(),
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "rate limited" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("falls back to a String(err) message when the GitHub lookup throws a non-Error value", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo }));
    h.githubClient.getDefaultBranch.mockRejectedValue("some string rejection");
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.startRun("LIN-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "some string rejection" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("uses getDefaultRepo() when getRepoByName returns null", async () => {
    const h = buildHarness(makeRun({ state: RunState.Todo, branchName: null }));
    h.repoRegistry.getRepoByName.mockReturnValue(null);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await svc.retryRun("run-1");

    expect(h.repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision missing plan", () => {
  it("runManualReReview throws when no Plan artifact exists", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("runManualPlanRevision throws when no Plan artifact exists", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("runManualPlanRevision passes no note object to runPlanRevision when opts.note is absent", async () => {
    const h = buildHarness(makeRun({ state: RunState.AwaitingPlanApproval }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "d" }],
      }),
    );

    await svc.runManualPlanRevision("run-1");

    // The 5th positional arg (the operator-note options object) must be
    // undefined when opts.note was not provided.
    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);
    const call = h.planReviserAgent.run.mock.calls[0];
    expect(call[3]).toBe("run-1");
    expect(call[4]).toBeUndefined();
  });
});

describe("OrchestratorService formatter branches", () => {
  it("formatExecutionReportComment: renders empty-files text, collapses >8 files into <details>, and lists notes", async () => {
    const h = buildHarness(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    );
    const svc = new OrchestratorService(h.deps as never);
    const manyFiles = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
    h.executorAgent.run.mockImplementation(async () => {
      const report = makeExecutionReport({
        filesChanged: manyFiles,
        notes: ["Discovered a flaky test", "Needed a small refactor"],
      });
      h.store.artifacts.push(
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      );
      return { report, prNumber: 101 };
    });

    await svc.runExecution("run-1");

    const reportComment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    const body = reportComment![1] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (10)");
    expect(body).toContain("### Notes");
    expect(body).toContain("Discovered a flaky test");
  });

  it("formatExecutionReportComment: renders no files-changed section when filesChanged is empty", async () => {
    const h = buildHarness(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
      [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    );
    const svc = new OrchestratorService(h.deps as never);
    h.executorAgent.run.mockImplementation(async () => {
      const report = makeExecutionReport({ filesChanged: [] });
      h.store.artifacts.push(
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      );
      return { report, prNumber: 101 };
    });

    await svc.runExecution("run-1");

    const reportComment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    expect(reportComment![1] as string).not.toContain("Files changed");
  });

  it("formatPlanReviewComment: renders a finding without an affectedStepId", async () => {
    const h = buildHarness(makeRun({ state: RunState.PlanReview }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", title: "No step ref", details: "d" },
        ],
      }),
    );

    await svc.runPlanReview("run-1");

    const comment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).not.toContain("(step");
  });

  it("formatCodeReviewComment: renders a finding with a lineHint", async () => {
    const h = buildHarness(makeRun({ state: RunState.AIReview, prNumber: 77 }), [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.reviewerAgent.run.mockImplementation(async () => {
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/foo.ts",
            lineHint: 42,
            title: "Bug",
            details: "d",
          },
        ],
      });
      h.store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    const comment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).toContain("src/foo.ts:42");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning query construction", () => {
  it("falls back to an empty title and slices the description when linearIssueTitle is null", async () => {
    // retryRun (unlike startRun) reads the pre-existing run's linearIssueTitle
    // / linearIssueDescription fields directly, rather than overwriting them
    // from a freshly-fetched Linear issue -- the right entry point to exercise
    // retrieveSkillsForPlanning's query-construction fallbacks in isolation.
    const h = buildHarness(
      makeRun({
        state: RunState.Todo,
        branchName: "ai/run-1",
        linearIssueTitle: null,
        linearIssueDescription: "A".repeat(300),
      }),
    );
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.retryRun("run-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      ` ${"A".repeat(200)}`,
      expect.any(Number),
    );
  });
});

describe("OrchestratorService.updateSkillMetrics edge cases", () => {
  it("defaults to an empty skillIds array when an injection event's payload omits skillIds", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    h.store.events.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown value when a skill metric update fails", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    h.store.events.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });
    h.agentSkillRepo.incrementSuccess.mockRejectedValue("plain string failure");
    const svc = new OrchestratorService(h.deps as never);

    await svc.approveHumanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "skill-1", error: "plain string failure" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService.approveHumanReview non-Error distillation failure", () => {
  it("stringifies a non-Error value thrown by distillationAgent.run", async () => {
    const h = buildHarness(makeRun({ state: RunState.ReadyForHumanReview }));
    h.distillationAgent.run.mockRejectedValue("plain distillation failure");
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain distillation failure" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});
