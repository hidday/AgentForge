import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    reviewerRuntime: "codex",
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
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "flaky" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Not yet green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found a bug",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Real issue" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(run: Run, review: Review | null, executionReport: ExecutionReport | null) {
  const artifacts: Artifact[] = [];
  if (review) artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
  if (executionReport) artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }));

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockResolvedValue({ ...run, state: RunState.AIReview }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, ...patch })),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockResolvedValue(artifacts),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
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

  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, execReport: ExecutionReport, _wd: string, runId: string): Promise<Remediation> => {
      const newReport = makeExecutionReport({
        executionVersion: execReport.executionVersion + 1,
        checks: { lint: { status: "pass", details: "ok" }, typecheck: { status: "pass", details: "ok" }, tests: { status: "pass", details: "ok" } },
        score: 0.95,
        scoreRationale: "Fixed.",
      });
      // Mirror production RemediationAgent: it persists the new ExecutionReport
      // (and a Remediation artifact) itself before returning.
      await artifactRepo.create({ runId, type: "ExecutionReport", version: newReport.executionVersion, payloadJson: newReport, rawText: "{}" });
      const remediation: Remediation = {
        reviewId: "rev-001",
        resolution: [{ findingId: "f1", status: "accepted", action: "Fixed bug", rationale: "Real bug" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
      await artifactRepo.create({ runId, type: "Remediation", version: 1, payloadJson: remediation, rawText: "{}" });
      return remediation;
    }),
  };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    deps: {
      runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
      linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
      reviewerAgent, remediationAgent, logger, dashboardEmitter,
    },
    runRepo,
    gitService,
    githubSync,
    remediationAgent,
    linearClient,
  };
}

describe("OrchestratorService.runRemediation", () => {
  it("with a PR number: pushes the fix commit and posts both the updated execution report and resolutions to GitHub", async () => {
    const run = makeRun({ prNumber: 42, branchName: "ai/run-1" });
    const { deps, gitService, githubSync, remediationAgent } = buildDeps(run, makeReview(), makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1", { f1: 555 });
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    // markReady at the tail end throws (pre-existing: verdict is still changes_requested) --
    // but everything up to that point must have executed.
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(remediationAgent.run).toHaveBeenCalledWith(makeReview(), makeExecutionReport(), "/tmp/worktree", "run-1");

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      { f1: 555 },
    );
  });

  it("without a PR number: skips both GitHub sync calls", async () => {
    const run = makeRun({ prNumber: null, branchName: "ai/run-1" });
    const { deps, githubSync } = buildDeps(run, makeReview(), makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("without a branchName: skips the git assertBranch/commitAndPush checkpoint", async () => {
    const run = makeRun({ branchName: null });
    const { deps, gitService } = buildDeps(run, makeReview(), makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("posts the remediation summary comment with the resolution items and score", async () => {
    const run = makeRun({});
    const { deps, linearClient } = buildDeps(run, makeReview(), makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    try {
      await svc.runRemediation("run-1");
    } catch {
      // expected pre-existing markReady failure; comments were posted before that.
    }

    const remediationComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Remediation Summary"));
    expect(remediationComment).toBeDefined();
    expect(remediationComment).toContain("f1");
    expect(remediationComment).toContain("Fixed bug");

    const updatedReportComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Execution Report (v2)"));
    expect(updatedReportComment).toBeDefined();
  });

  it("rejects with a PolicyViolationError before invoking the remediation agent when there is no Review artifact", async () => {
    const run = makeRun({});
    const { deps, remediationAgent } = buildDeps(run, null, makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });

  it("rejects with a PolicyViolationError when the run is not in AddressingReview", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { deps, remediationAgent } = buildDeps(run, makeReview(), makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });
});
