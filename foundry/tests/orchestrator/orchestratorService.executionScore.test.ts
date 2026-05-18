import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
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
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.AddressingReview,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Initial implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      // v1 has failing tests — this is the key fixture: if markReady mistakenly read
      // the v1 ExecutionReport, it would fail the "green checks" assertion *before*
      // the verdict assertion, with a different error code. The test relies on this
      // distinction to confirm v2's checks are the ones being read.
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "one regression test failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.55,
    scoreRationale: "Tests not yet green.",
    ...overrides,
  };
}

function makeReview(): Review {
  return {
    reviewId: "rev-001",
    summary: "Found one bug",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "Real issue",
      },
    ],
    overallVerdict: "changes_requested",
  };
}

function makeRemediation(newReport: ExecutionReport): Remediation {
  return {
    reviewId: "rev-001",
    resolution: [
      {
        findingId: "f1",
        status: "accepted",
        action: "Fixed bug",
        rationale: "Real bug",
      },
    ],
    readyForHumanReview: true,
    executionReport: newReport,
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
}

function buildDeps(store: TestStore, initialRun: Run) {
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
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({
        type: params.type,
        version: params.version,
        payloadJson: params.payloadJson,
      });
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
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };

  // The real RemediationAgent writes both ExecutionReport (v_n+1) and Remediation
  // artifacts. Simulate the same behaviour here so the orchestrator integration
  // sees the same post-conditions it would in production.
  const remediationAgent = {
    run: vi
      .fn<Parameters<typeof actualRemediationRun>, ReturnType<typeof actualRemediationRun>>()
      .mockImplementation(actualRemediationRun),
  };

  async function actualRemediationRun(
    _review: Review,
    executionReport: ExecutionReport,
    _workingDirectory: string,
    _runId: string,
  ): Promise<Remediation> {
    const newReport = makeExecutionReport({
      executionVersion: executionReport.executionVersion + 1,
      summary: "Post-remediation state.",
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "all tests pass" },
      },
      score: 0.9,
      scoreRationale: "Bug fixed; tests now green.",
    });
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
  }

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
      logger,
      dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    reviewerAgent,
    remediationAgent,
    linearClient,
  };
}

describe("OrchestratorService -- execution score and versioning integration", () => {
  // The full execute -> review (changes_requested) -> remediate -> markReady flow
  // includes a pre-existing concern: assertCanMarkReady requires the latest Review
  // to have verdict "approved", which today's runRemediation does not arrange.
  // Re-triggering review after remediation is explicitly out of scope for this plan.
  //
  // We rely on the ordering inside assertCanMarkReady to verify the *interesting*
  // property: that the v2 ExecutionReport (post-remediation) is what markReady
  // reads. Specifically, the green-checks assertion runs BEFORE the verdict
  // assertion. So if markReady throws "ready_requires_approved_verdict" rather
  // than "ready_requires_green_checks", the v2 (passing) checks were read.

  it(
    "runRemediation writes a v2 ExecutionReport that becomes the latest and feeds into markReady",
    async () => {
      const store: TestStore = {
        runState: RunState.AddressingReview,
        artifacts: [
          asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
          asArtifact({
            type: "ExecutionReport",
            version: 1,
            payloadJson: makeExecutionReport(),
          }),
          asArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
        ],
      };

      const initialRun = makeRun({ state: RunState.AddressingReview });
      const built = buildDeps(store, initialRun);
      const svc = new OrchestratorService(built.deps as never);

      // markReady is expected to throw on the *verdict* check (pre-existing; not
      // our scope). We catch and inspect to confirm v2 ExecutionReport was read.
      let caught: PolicyViolationError | undefined;
      try {
        await svc.runRemediation("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }

      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_approved_verdict");

      // The latest ExecutionReport should be v2 (post-remediation), proving the
      // RemediationAgent wrote it and findLatestByType orders by version desc.
      const reports = store.artifacts.filter((a) => a.type === "ExecutionReport");
      expect(reports.map((r) => r.version).sort()).toEqual([1, 2]);

      const latestReport = reports.reduce((best, cur) =>
        cur.version > best.version ? cur : best,
      );
      expect(latestReport.version).toBe(2);
      const payload = latestReport.payloadJson as ExecutionReport;
      expect(payload.executionVersion).toBe(2);
      expect(payload.score).toBe(0.9);
      expect(payload.checks.tests.status).toBe("pass");

      // The Remediation artifact was persisted alongside.
      const remediations = store.artifacts.filter((a) => a.type === "Remediation");
      expect(remediations).toHaveLength(1);

      // RemediationAgent received the v1 ExecutionReport (orchestrator pulled
      // latest *before* remediation wrote v2).
      expect(built.remediationAgent.run).toHaveBeenCalledTimes(1);
      const remediationCallArg = built.remediationAgent.run.mock.calls[0]?.[1] as
        | ExecutionReport
        | undefined;
      expect(remediationCallArg?.executionVersion).toBe(1);

      // State transitions through the remediation lane were recorded.
      const eventTypes = built.eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
      expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    },
  );
});
