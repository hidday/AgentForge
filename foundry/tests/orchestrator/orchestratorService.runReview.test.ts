import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
} from "./_helpers/fixtures.js";

describe("OrchestratorService.runReview", () => {
  it("throws via PolicyEngine when there is no execution report", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("fetches the PR diff and passes it to the reviewer when prNumber is set", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, githubClient, reviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    githubClient.getPRDiff.mockResolvedValue("diff --git a/x b/x\n+added");
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 202);
    expect(reviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "diff --git a/x b/x\n+added",
      expect.anything(),
      "run-1",
    );
  });

  it("throws via PolicyEngine when the run has no prNumber", async () => {
    // PolicyEngine.assertCanReview requires run.prNumber to be set, which means
    // the `run.prNumber ? ... : ""` diff fallback further down in runReview is
    // unreachable in practice -- assertCanReview always rejects a null prNumber
    // first. Covered directly here and at the PolicyEngine level.
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: null });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("approved verdict: transitions to ReadyForHumanReview via markReady, does not post GitHub findings when there are none", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, githubSync, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    const review = makeReview({ overallVerdict: "approved", findings: [] });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });

  it("changes_requested verdict: posts findings to GitHub, transitions to AddressingReview, and chains into runRemediation", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, githubSync, reviewerAgent, remediationAgent, linearClient } =
      buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "Bug", details: "Fix it" },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));
    // NOTE: today's RemediationAgent never re-writes the Review artifact with an
    // "approved" verdict (see orchestratorService.executionScore.test.ts, which
    // documents this as a pre-existing, out-of-scope gap: markReady after
    // remediation always throws ready_requires_approved_verdict in production).
    // We simulate a corrected Review artifact here as a side effect of the mocked
    // remediationAgent so this test can exercise runRemediation's full success path
    // (transition to ReadyForHumanReview) rather than re-asserting that known gap.
    remediationAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Review", { ...review, overallVerdict: "approved" as const });
      return {
        reviewId: "review-1",
        resolution: [{ findingId: "f1", status: "accepted" as const, action: "Fixed", rationale: "Simple" }],
        readyForHumanReview: true,
        executionReport: makeExecutionReport({ executionVersion: 2 }),
      };
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      202,
      review.findings,
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(remediationAgent.run).toHaveBeenCalled();
    // runRemediation ends with REVIEW_APPROVED -> ReadyForHumanReview via markReady
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not post GitHub findings when changes_requested but there are no findings", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, githubSync, reviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    // With no findings, assertCanRemediate (called inside the ensuing
    // runRemediation) rejects the run for lacking findings to remediate — but
    // that happens *after* the postReviewFindings guard we're testing here.
    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot remediate without review findings/);

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws via PolicyEngine when the review verdict is not changes_requested", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Review", makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("asserts branch, commits+pushes, updates remediationRuntime, posts comments, updates GitHub, and marks ready", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview, prNumber: 202, branchName: "ai/run-1" });
    const { deps, runRepo, gitService, githubSync, linearClient, remediationAgent, artifactRepo } =
      buildFullDeps(run);
    artifactRepo.seed("Review", makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "Bug", details: "Fix" }],
    }));
    artifactRepo.seed("ExecutionReport", makeExecutionReport({ executionVersion: 1, score: 0.5 }));
    const remediation = {
      reviewId: "review-1",
      resolution: [{ findingId: "f1", status: "accepted" as const, action: "Fixed", rationale: "Simple fix" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    };
    // See the changes_requested runReview test above: today's RemediationAgent
    // never re-writes the Review artifact as "approved", so markReady after
    // remediation would otherwise reject (documented in
    // orchestratorService.executionScore.test.ts). Simulate the corrected
    // artifact here to exercise runRemediation's full success path.
    remediationAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Review", makeReview({ overallVerdict: "approved" }));
      return remediation;
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runRemediation("run-1", { f1: 555 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(runRepo.getCurrent().remediationRuntime).toBe("claude-code");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Remediation Summary"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      202,
      remediation.executionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      202,
      remediation.resolution,
      { f1: 555 },
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips git operations and GitHub sync when the run has no branchName / no prNumber", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview, prNumber: null, branchName: null });
    const { deps, gitService, githubSync, remediationAgent, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Review", makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "Bug", details: "Fix" }],
    }));
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    remediationAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Review", makeReview({ overallVerdict: "approved" }));
      return {
        reviewId: "review-1",
        resolution: [],
        readyForHumanReview: true,
        executionReport: makeExecutionReport({ executionVersion: 2 }),
      };
    });

    const svc = new OrchestratorService(deps as never);
    // No prNumber means markReady (chained at the end) rejects via PolicyEngine;
    // that's expected here since this test's focus is the branch/PR-conditional
    // git and GitHub sync calls earlier in the method.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws via PolicyEngine when checks are failing", async () => {
    const run = makeRun({ id: "run-1", prNumber: 202 });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed(
      "ExecutionReport",
      makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      }),
    );
    artifactRepo.seed("Review", makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("posts the completion comment and returns the run when policy checks pass", async () => {
    const run = makeRun({ id: "run-1", prNumber: 202 });
    const { deps, artifactRepo, linearClient } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Review", makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result).toBeDefined();
  });
});
