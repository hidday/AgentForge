import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";
import { buildDeps, makeStore, pushArtifact, type Store } from "./helpers/fixtures.js";

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "one failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Not green yet",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "detail",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeRemediation(newReport: ExecutionReport, overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
    ],
    readyForHumanReview: true,
    executionReport: newReport,
    ...overrides,
  };
}

function setupAddressingReviewRun(store: Store, opts: { prNumber?: number | null } = {}) {
  store.run = {
    ...store.run,
    state: RunState.AddressingReview,
    prNumber: opts.prNumber === undefined ? 42 : opts.prNumber,
  };
  pushArtifact(store, "Review", 1, makeReview());
  pushArtifact(store, "ExecutionReport", 1, makeExecutionReport());
}

describe("OrchestratorService.runRemediation", () => {
  it("throws via PolicyEngine when preconditions are not met (e.g. no review artifact)", async () => {
    const store = makeStore();
    store.run = { ...store.run, state: RunState.AddressingReview };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("runs the remediation agent, commits, posts comments, syncs GitHub, and delegates to markReady", async () => {
    const store = makeStore();
    setupAddressingReviewRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const newReport = makeExecutionReport({
      executionVersion: 2,
      score: 0.9,
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    const remediation = makeRemediation(newReport);
    built.remediationAgent.run.mockResolvedValue(remediation);

    const differentRun = { ...store.run, id: "different" } as never;
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(differentRun);

    const result = await svc.runRemediation("run-1", { f1: 100 });

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.remediationAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: "rev-1" }),
      expect.objectContaining({ executionVersion: 1 }),
      "/tmp/worktree",
      "run-1",
    );
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", {
      remediationRuntime: "claude-code",
    });

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

    // Two comments: the new execution report, then the remediation summary.
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Remediation Summary"),
    );

    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      newReport,
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.resolution,
      { f1: 100 },
    );

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    // Documents current behavior: runRemediation discards markReady's return value.
    expect(result).not.toBe(differentRun);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("defaults commentMap to {} when not passed", async () => {
    const store = makeStore();
    setupAddressingReviewRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation(makeExecutionReport({ executionVersion: 2 })),
    );
    vi.spyOn(svc, "markReady").mockResolvedValue(store.run as never);

    await svc.runRemediation("run-1");

    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      {},
    );
  });

  it("skips branch assertion and commit when the run has no branchName", async () => {
    const store = makeStore();
    setupAddressingReviewRun(store);
    store.run.branchName = null;
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation(makeExecutionReport({ executionVersion: 2 })),
    );
    vi.spyOn(svc, "markReady").mockResolvedValue(store.run as never);

    await svc.runRemediation("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("skips GitHub sync calls when the run has no PR number", async () => {
    const store = makeStore();
    setupAddressingReviewRun(store, { prNumber: null });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation(makeExecutionReport({ executionVersion: 2 })),
    );
    vi.spyOn(svc, "markReady").mockResolvedValue(store.run as never);

    await svc.runRemediation("run-1");

    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts a completion comment and returns the run when policy allows it", async () => {
    const store = makeStore();
    store.run = { ...store.run, state: RunState.AIReview, prNumber: 42 };
    pushArtifact(
      store,
      "Review",
      1,
      makeReview({ overallVerdict: "approved", findings: [] }),
    );
    pushArtifact(
      store,
      "ExecutionReport",
      1,
      makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe("run-1");
  });

  it("propagates the PolicyEngine violation and does not post a comment when preconditions fail", async () => {
    const store = makeStore();
    store.run = { ...store.run, state: RunState.AIReview, prNumber: null };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.linearClient.postComment).not.toHaveBeenCalled();
  });
});
