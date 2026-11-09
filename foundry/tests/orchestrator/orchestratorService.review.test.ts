import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  makeArtifact,
  wireReviewerAgent,
  wireRemediationAgent,
} from "./fixtures.js";

describe("OrchestratorService.runReview", () => {
  it("throws PolicyViolationError when run is not in AIReview", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 1 });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when there is no PR number", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: null });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/without an existing PR/);
  });

  it("throws PolicyViolationError when there is no execution report", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 1 });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/completed execution report/);
  });

  it("approved verdict: skips posting review findings (none) and marks ready", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 10, planVersion: 1 });
    const { deps, store, reviewerAgent, artifactRepo, githubSync, githubClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireReviewerAgent(artifactRepo, reviewerAgent, () => makeReview({ overallVerdict: "approved", findings: [] }));

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 10);
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(store.run.reviewerRuntime).toBe("codex");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.REVIEW_APPROVED);
  });

  it("changes_requested verdict: posts review findings to GitHub and chains into remediation", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.AIReview,
      prNumber: 10,
      planVersion: 1,
      branchName: "ai/run-1",
    });
    const { deps, store, reviewerAgent, remediationAgent, artifactRepo, githubSync, linearClient } =
      buildStoreDeps(initialRun, [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport({ executionVersion: 1 }) }),
      ]);
    const svc = new OrchestratorService(deps as never);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "x" }],
    });
    wireReviewerAgent(artifactRepo, reviewerAgent, () => review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));
    wireRemediationAgent(artifactRepo, remediationAgent, (prev) =>
      makeExecutionReport({ executionVersion: prev.executionVersion + 1, score: 0.95 }),
    );

    // NOTE (pre-existing behavior, not introduced by this test): runRemediation
    // ends by calling markReady, which re-reads the latest "Review" artifact.
    // Since remediation does not re-trigger code review, that artifact is
    // still the "changes_requested" one that originally triggered remediation,
    // so markReady's verdict check always throws here. This mirrors the
    // documented caveat in orchestratorService.executionScore.test.ts.
    let caught: unknown;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect((caught as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 10, review.findings, "changes_requested");
    expect(remediationAgent.run).toHaveBeenCalled();
    const remediationCallArg = remediationAgent.run.mock.calls[0]?.[1];
    expect((remediationCallArg as { executionVersion: number }).executionVersion).toBe(1);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        RunEvent.REVIEW_CHANGES_REQUESTED,
        RunEvent.REMEDIATION_FINISHED,
        RunEvent.REVIEW_APPROVED,
      ]),
    );
    // The REVIEW_APPROVED transition (AIReview -> ReadyForHumanReview) completes
    // and persists before markReady's throw.
    expect(store.run.state).toBe(RunState.ReadyForHumanReview);
    const codeReviewComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("AI Code Review"),
    );
    expect(codeReviewComment).toBeDefined();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws PolicyViolationError when not in AddressingReview", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "nit", type: "x", file: "a", title: "t", details: "d" }] }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when review verdict is not changes_requested", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AddressingReview });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(/changes_requested/);
  });

  it("throws PolicyViolationError when review has no findings", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AddressingReview });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [] }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(/without review findings/);
  });

  it("happy path with branchName and prNumber: checkpoints git, syncs GitHub, and marks ready", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.AddressingReview,
      branchName: "ai/run-1",
      prNumber: 20,
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "x" }],
    });
    const { deps, store, remediationAgent, artifactRepo, gitService, githubSync, linearClient } = buildStoreDeps(
      initialRun,
      [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport({ executionVersion: 1, score: 0.5 }) }),
      ],
    );
    const svc = new OrchestratorService(deps as never);

    wireRemediationAgent(artifactRepo, remediationAgent, (prev) =>
      makeExecutionReport({ executionVersion: prev.executionVersion + 1, score: 0.9 }),
    );

    // See the NOTE above runReview's "changes_requested" test: markReady's
    // final verdict check always throws here since the Review artifact is
    // never re-approved by this flow. We still assert every side effect that
    // happens on the way there.
    let caught: unknown;
    try {
      await svc.runRemediation("run-1", { f1: 101 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect((caught as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith("/tmp", "ai/run-1", expect.stringContaining("Remediation"));
    expect(store.run.remediationRuntime).toBe("claude-code");
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      20,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      20,
      expect.anything(),
      { f1: 101 },
    );
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.REMEDIATION_FINISHED, RunEvent.REVIEW_APPROVED]),
    );
    expect(store.run.state).toBe(RunState.ReadyForHumanReview);
    const remediationComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Remediation Summary"),
    );
    expect(remediationComment).toBeDefined();
  });

  it("skips git checkpoint and GitHub sync when there is no branchName/prNumber", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AddressingReview, branchName: null, prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "x" }],
    });
    const { deps, remediationAgent, artifactRepo, gitService, githubSync } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: review }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport({ executionVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireRemediationAgent(artifactRepo, remediationAgent, (prev) =>
      makeExecutionReport({ executionVersion: prev.executionVersion + 1 }),
    );

    // markReady throws (no PR number) at the very end; the skip assertions
    // below all concern behavior that happens before that point.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});
