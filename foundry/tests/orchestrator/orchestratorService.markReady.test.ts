import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 2,
    summary: "Post-remediation implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.95,
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "All good",
    findings: [],
    overallVerdict: "approved",
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
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn(),
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
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
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
    runRepo,
    artifactRepo,
    linearClient,
    logger,
  };
}

function wireArtifacts(
  artifactRepo: ReturnType<typeof buildDeps>["artifactRepo"],
  opts: { review?: Review | null; executionReport?: ExecutionReport | null } = {},
) {
  const review = opts.review === undefined ? makeReview() : opts.review;
  const executionReport =
    opts.executionReport === undefined ? makeExecutionReport() : opts.executionReport;

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

describe("OrchestratorService.markReady", () => {
  describe("assertCanMarkReady policy violations", () => {
    it("throws when the run has no PR", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
      wireArtifacts(artifactRepo);

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_pr");
    });

    it("throws when there is no execution report", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, { executionReport: null });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_execution_report");
    });

    it("throws when a check (lint/typecheck/tests) failed", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, {
        executionReport: makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "fail", details: "regression" },
          },
        }),
      });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_green_checks");
    });

    it("throws when there is no review", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, { review: null });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_review");
    });

    it("throws when the latest review verdict is not approved", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, {
        review: makeReview({ overallVerdict: "changes_requested" }),
      });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_approved_verdict");
    });

    it("throws when there are unresolved blocker findings", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, {
        review: makeReview({
          overallVerdict: "approved",
          findings: [
            {
              id: "f1",
              severity: "blocker",
              type: "bug",
              file: "src/foo.ts",
              title: "Still broken",
              details: "x",
            },
          ],
        }),
      });

      let caught: PolicyViolationError | undefined;
      try {
        await svc.markReady("run-1");
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("ready_requires_blockers_resolved");
    });
  });

  describe("happy path", () => {
    it("posts the completion comment and returns the run, without mutating its state itself", async () => {
      const { deps, runRepo, artifactRepo, linearClient, logger } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun();
      runRepo.findById.mockResolvedValue(run);
      wireArtifacts(artifactRepo);

      const result = await svc.markReady("run-1");

      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        "AI workflow complete. Issue marked as **Ready for Human Review**.",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", state: run.state }),
        "Run marked as ready for human review",
      );
      // markReady itself performs no state transition -- it only validates and comments.
      expect(runRepo.updateState).not.toHaveBeenCalled();
      expect(result).toBe(run);
    });

    it("allows non-blocker findings (important/suggestion/nit) to remain unresolved", async () => {
      const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(makeRun());
      wireArtifacts(artifactRepo, {
        review: makeReview({
          overallVerdict: "approved",
          findings: [
            {
              id: "f1",
              severity: "suggestion",
              type: "style",
              file: "src/foo.ts",
              title: "Minor nit",
              details: "x",
            },
          ],
        }),
      });

      await expect(svc.markReady("run-1")).resolves.toBeDefined();
      expect(linearClient.postComment).toHaveBeenCalled();
    });
  });
});
