import { describe, it, expect, vi, afterEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
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
    prNumber: 42,
    state: RunState.AIReview,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
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
  // Keep a mutable "current run" so that runRepo.update / updateState reflect
  // patches onto the same object instead of losing fields like `state`
  // (transitionAndRecord reads run.state to compute the next transition).
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

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/foo b/foo"),
  };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = { run: vi.fn() };

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
      ...overrides,
    },
    setRun: (run: Run) => {
      current = run;
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    dashboardEmitter,
  };
}

/** Wires findLatestByType to return sensible defaults for a run in AIReview. */
function wireArtifacts(
  artifactRepo: ReturnType<typeof buildDeps>["artifactRepo"],
  opts: { plan?: Plan; executionReport?: ExecutionReport | null } = {},
) {
  const plan = opts.plan ?? makePlan();
  const executionReport =
    opts.executionReport === null ? null : (opts.executionReport ?? makeExecutionReport());

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
    if (type === "ExecutionReport") {
      return Promise.resolve(
        executionReport
          ? asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport })
          : null,
      );
    }
    return Promise.resolve(null);
  });
}

describe("OrchestratorService.runReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("policy preconditions", () => {
    it("throws PolicyViolationError with rule when run is not in AIReview state", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun({ state: RunState.Implementing }));
      wireArtifacts(artifactRepo);

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runReview("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("review_requires_ai_review_state");
    });

    it("throws PolicyViolationError when run has no PR number", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun({ prNumber: null }));
      wireArtifacts(artifactRepo);

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runReview("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("review_requires_pr");
    });

    it("throws PolicyViolationError when no ExecutionReport artifact exists", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo, { executionReport: null });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runReview("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("review_requires_execution_report");
    });
  });

  describe("reviewer invocation", () => {
    it("fetches the PR diff and passes it to reviewerAgent.run", async () => {
      const { deps, setRun, artifactRepo, githubClient, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      const plan = makePlan();
      const report = makeExecutionReport();
      wireArtifacts(artifactRepo, { plan, executionReport: report });
      reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

      await svc.runReview("run-1");

      expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
      expect(reviewerAgent.run).toHaveBeenCalledWith(
        plan,
        report,
        "diff --git a/foo b/foo",
        expect.anything(),
        "run-1",
      );
    });

    it("persists reviewerRuntime='codex' on the run", async () => {
      const { deps, setRun, artifactRepo, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo);
      vi.spyOn(OrchestratorService.prototype, "markReady").mockResolvedValue(
        makeRun({ state: RunState.ReadyForHumanReview }),
      );

      await svc.runReview("run-1");

      expect(runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    });
  });

  describe("commentMap population", () => {
    it("posts review findings to GitHub and builds commentMap when findings exist", async () => {
      const { deps, setRun, artifactRepo, githubSync, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo);

      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "x" },
        ],
      });
      reviewerAgent.run.mockResolvedValue(review);
      githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));

      const remediationSpy = vi
        .spyOn(OrchestratorService.prototype, "runRemediation")
        .mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

      await svc.runReview("run-1");

      expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
        "test-repo",
        42,
        review.findings,
        "changes_requested",
      );
      expect(remediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    });

    it("does NOT post review findings when there are none", async () => {
      const { deps, setRun, artifactRepo, githubSync, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo);
      reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

      await svc.runReview("run-1");

      expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
      expect(markReadySpy).toHaveBeenCalledWith("run-1");
    });
  });

  describe("changes_requested verdict", () => {
    it("transitions to AddressingReview, posts the review comment, and delegates to runRemediation", async () => {
      const { deps, setRun, artifactRepo, eventRepo, linearClient, reviewerAgent, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo);

      const review = makeReview({
        overallVerdict: "changes_requested",
        summary: "Needs work",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "src/foo.ts", lineHint: 42, title: "Bug", details: "x" },
        ],
      });
      reviewerAgent.run.mockResolvedValue(review);

      const finalRun = makeRun({ state: RunState.AIReview });
      const remediationSpy = vi
        .spyOn(OrchestratorService.prototype, "runRemediation")
        .mockResolvedValue(finalRun);

      const result = await svc.runReview("run-1");

      // State transition recorded
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", eventType: RunEvent.REVIEW_CHANGES_REQUESTED }),
      );
      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AddressingReview);

      // Comment posted with verdict + summary
      const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
      );
      expect(comment).toBeDefined();
      expect(comment![1]).toContain("Needs work");
      expect(comment![1]).toContain("src/foo.ts:42");

      // Delegates to runRemediation and returns its result
      expect(remediationSpy).toHaveBeenCalledWith("run-1", {});
      expect(result).toBe(finalRun);
    });
  });

  describe("approved verdict", () => {
    it("transitions to ReadyForHumanReview and delegates to markReady, returning the transitioned run", async () => {
      const { deps, setRun, artifactRepo, eventRepo, linearClient, reviewerAgent, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      setRun(makeRun());
      wireArtifacts(artifactRepo);

      reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

      const result = await svc.runReview("run-1");

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", eventType: RunEvent.REVIEW_APPROVED }),
      );
      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.ReadyForHumanReview);
      expect(markReadySpy).toHaveBeenCalledWith("run-1");

      // runReview returns the run from the REVIEW_APPROVED transition, not markReady's return value
      expect(result.state).toBe(RunState.ReadyForHumanReview);

      // No code-review comment is posted on the approved path (only markReady comments)
      expect(linearClient.postComment).not.toHaveBeenCalled();
    });
  });
});
