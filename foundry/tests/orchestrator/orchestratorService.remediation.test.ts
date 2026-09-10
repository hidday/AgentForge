import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Initial implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "one failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Not green yet.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "x" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  const executionReport = makeExecutionReport({
    executionVersion: 2,
    score: 0.9,
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all green" },
    },
  });
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport,
    ...overrides,
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
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn().mockResolvedValue(makeRemediation()) };

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
    gitService,
    githubSync,
    remediationAgent,
  };
}

function wireArtifacts(
  artifactRepo: ReturnType<typeof buildDeps>["artifactRepo"],
  opts: { review?: Review | null; executionReport?: ExecutionReport | null } = {},
) {
  const review = opts.review === null ? null : (opts.review ?? makeReview());
  const executionReport =
    opts.executionReport === null ? null : (opts.executionReport ?? makeExecutionReport());

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Review") {
      return Promise.resolve(
        review ? asArtifact({ type: "Review", version: 1, payloadJson: review }) : null,
      );
    }
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

describe("OrchestratorService.runRemediation", () => {
  describe("policy preconditions (assertCanRemediate)", () => {
    it("throws PolicyViolationError when run is not in AddressingReview state", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ state: RunState.AIReview }));
      wireArtifacts(artifactRepo);

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runRemediation("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
    });

    it("throws PolicyViolationError when no Review artifact exists", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun());
      wireArtifacts(artifactRepo, { review: null });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runRemediation("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("remediate_requires_review");
    });

    it("throws PolicyViolationError when the review verdict is not changes_requested", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun());
      wireArtifacts(artifactRepo, { review: makeReview({ overallVerdict: "approved" }) });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runRemediation("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
    });

    it("throws PolicyViolationError when the review has no findings", async () => {
      const { deps, setRun, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun());
      wireArtifacts(artifactRepo, { review: makeReview({ findings: [] }) });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.runRemediation("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("remediate_requires_findings");
    });
  });

  describe("branchName-dependent git operations", () => {
    it("asserts the branch and commits/pushes when the run has a branchName", async () => {
      const { deps, setRun, artifactRepo, gitService } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ branchName: "ai/run-1" }));
      wireArtifacts(artifactRepo);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun());

      await svc.runRemediation("run-1");

      expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
      expect(gitService.commitAndPush).toHaveBeenCalledWith(
        "/tmp/worktree",
        "ai/run-1",
        expect.stringContaining("Remediation"),
      );
      markReadySpy.mockRestore();
    });

    it("skips branch assertion and commit/push when the run has no branchName", async () => {
      const { deps, setRun, artifactRepo, gitService } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ branchName: null }));
      wireArtifacts(artifactRepo);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun());

      await svc.runRemediation("run-1");

      expect(gitService.assertBranch).not.toHaveBeenCalled();
      expect(gitService.commitAndPush).not.toHaveBeenCalled();
      markReadySpy.mockRestore();
    });
  });

  describe("prNumber-dependent GitHub sync", () => {
    it("posts execution report update and remediation resolutions with the provided commentMap when prNumber is set", async () => {
      const { deps, setRun, artifactRepo, githubSync, remediationAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ prNumber: 99 }));
      wireArtifacts(artifactRepo);

      const remediation = makeRemediation();
      remediationAgent.run.mockResolvedValue(remediation);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun());

      const commentMap = { f1: 555 };
      await svc.runRemediation("run-1", commentMap);

      expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
        "test-repo",
        99,
        remediation.executionReport,
      );
      expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
        "test-repo",
        99,
        remediation.resolution,
        commentMap,
      );
      markReadySpy.mockRestore();
    });

    it("defaults commentMap to {} when not provided", async () => {
      const { deps, setRun, artifactRepo, githubSync } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ prNumber: 99 }));
      wireArtifacts(artifactRepo);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun());

      await svc.runRemediation("run-1");

      expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
        "test-repo",
        99,
        expect.anything(),
        {},
      );
      markReadySpy.mockRestore();
    });

    it("skips GitHub sync calls entirely when the run has no prNumber", async () => {
      const { deps, setRun, artifactRepo, githubSync } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun({ prNumber: null }));
      wireArtifacts(artifactRepo);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun());

      await svc.runRemediation("run-1");

      expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
      expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
      markReadySpy.mockRestore();
    });
  });

  describe("happy path outcome", () => {
    it("invokes remediationAgent with review/executionReport/workingDirectory, persists remediationRuntime, transitions REMEDIATION_FINISHED then REVIEW_APPROVED, posts comments, and calls markReady", async () => {
      const { deps, setRun, artifactRepo, eventRepo, linearClient, runRepo, remediationAgent } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);
      setRun(makeRun());
      const review = makeReview();
      const executionReport = makeExecutionReport();
      wireArtifacts(artifactRepo, { review, executionReport });

      const remediation = makeRemediation();
      remediationAgent.run.mockResolvedValue(remediation);

      const markReadySpy = vi
        .spyOn(OrchestratorService.prototype, "markReady")
        .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

      const result = await svc.runRemediation("run-1");

      expect(remediationAgent.run).toHaveBeenCalledWith(
        review,
        executionReport,
        "/tmp/worktree",
        "run-1",
      );
      expect(runRepo.update).toHaveBeenCalledWith("run-1", { remediationRuntime: "claude-code" });

      const eventTypes = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
      expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

      // Both the execution-report comment and the remediation-summary comment are posted
      const comments = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[1] as string,
      );
      expect(comments.some((c) => c.includes("Execution Report"))).toBe(true);
      expect(comments.some((c) => c.includes("Remediation Summary"))).toBe(true);

      expect(markReadySpy).toHaveBeenCalledWith("run-1");
      expect(result.state).toBe(RunState.ReadyForHumanReview);

      markReadySpy.mockRestore();
    });
  });
});
