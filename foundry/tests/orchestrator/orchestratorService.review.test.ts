import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makeExecutionReport,
  makePlan,
  makeRemediation,
  makeReview,
  makeRun,
} from "./testSupport.js";

describe("OrchestratorService.runReview", () => {
  it("throws a PolicyViolationError when the run is not in AIReview state", async () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "review_requires_ai_review_state",
    });
  });

  it("throws a PolicyViolationError when the run has no PR", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({ rule: "review_requires_pr" });
  });

  it("throws a PolicyViolationError when there is no ExecutionReport", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "review_requires_execution_report",
    });
  });

  it("fetches the PR diff when prNumber is set, and posts findings via githubSync when there are findings", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, githubClient, githubSync, reviewerAgent } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
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
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 111]]));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 5);
    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      5,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
  });

  it("does not call githubSync.postReviewFindings when the review has no findings", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, reviewerAgent, githubSync } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("on changes_requested: transitions REVIEW_CHANGES_REQUESTED, posts the code review comment, and delegates to runRemediation with the comment map", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, reviewerAgent, githubSync, linearClient } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            lineHint: 42,
            title: "Null deref",
            details: "Will crash",
          },
        ],
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    const result = await svc.runReview("run-1");

    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 555 });

    const changesEvent = store.events.find(
      (e) => e.eventType === (RunEvent.REVIEW_CHANGES_REQUESTED as string),
    );
    expect(changesEvent).toBeDefined();

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Changes Requested");
    expect(comment![1]).toContain("Null deref");
    expect(comment![1]).toContain("(src/foo.ts:42)");
    void result;
  });

  it("on approved: transitions REVIEW_APPROVED and delegates to markReady", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, reviewerAgent } = buildDeps(store);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    const approvedEvent = store.events.find(
      (e) => e.eventType === (RunEvent.REVIEW_APPROVED as string),
    );
    expect(approvedEvent).toBeDefined();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService.runRemediation", () => {
  function baseArtifacts() {
    return [
      makeArtifact({
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
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ];
  }

  it("throws a PolicyViolationError when the run is not in AddressingReview state", async () => {
    const run = makeRun({ state: RunState.AIReview });
    const store = createStore(run, baseArtifacts());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_addressing_review_state",
    });
  });

  it("throws a PolicyViolationError when there is no Review artifact", async () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_review",
    });
  });

  it("throws a PolicyViolationError when the review verdict is not changes_requested", async () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const store = createStore(run, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_changes_requested_verdict",
    });
  });

  it("throws a PolicyViolationError when the review has no findings", async () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const store = createStore(run, [
      makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [] }),
      }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_findings",
    });
  });

  it("asserts and commits on the branch when branchName is set", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null });
    const store = createStore(run, baseArtifacts());
    const { deps, gitService, remediationAgent } = buildDeps(store);
    remediationAgent.run.mockResolvedValue(makeRemediation());
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
  });

  it("skips branch assertions and github PR sync when branchName/prNumber are unset", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const store = createStore(run, baseArtifacts());
    const { deps, gitService, remediationAgent, githubSync } = buildDeps(store);
    remediationAgent.run.mockResolvedValue(makeRemediation());
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("on success with a PR: posts execution-report-then-remediation comments (in that order), syncs github, transitions REMEDIATION_FINISHED then REVIEW_APPROVED, and calls markReady", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 7 });
    const store = createStore(run, baseArtifacts());
    const { deps, remediationAgent, githubSync, linearClient } = buildDeps(store);
    const remediation = makeRemediation({
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Was real" }],
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    });
    remediationAgent.run.mockResolvedValue(remediation);
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1", { f1: 999 });

    expect(store.run.remediationRuntime).toBe("claude-code");

    const finishedIdx = store.events.findIndex(
      (e) => e.eventType === (RunEvent.REMEDIATION_FINISHED as string),
    );
    const approvedIdx = store.events.findIndex(
      (e) => e.eventType === (RunEvent.REVIEW_APPROVED as string),
    );
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThan(finishedIdx);

    // Execution report comment posted before the remediation summary comment.
    const calls = linearClient.postComment.mock.calls as [string, string][];
    expect(calls[0][1]).toContain("Execution Report");
    expect(calls[1][1]).toContain("Remediation Summary");

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.executionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.resolution,
      { f1: 999 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("defaults commentMap to {} when not provided", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: 7 });
    const store = createStore(run, baseArtifacts());
    const { deps, remediationAgent, githubSync } = buildDeps(store);
    remediationAgent.run.mockResolvedValue(makeRemediation());
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.anything(),
      {},
    );
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws when there is no PR", async () => {
    const run = makeRun({ prNumber: null });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({ rule: "ready_requires_pr" });
  });

  it("throws when there is no ExecutionReport", async () => {
    const run = makeRun({ prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({
      rule: "ready_requires_execution_report",
    });
  });

  it("throws when a check is failing", async () => {
    const run = makeRun({ prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "fail", details: "boom" },
          },
        }),
      }),
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({
      rule: "ready_requires_green_checks",
    });
  });

  it("throws when there is no Review", async () => {
    const run = makeRun({ prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({ rule: "ready_requires_review" });
  });

  it("throws when the review verdict is not approved", async () => {
    const run = makeRun({ prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({ overallVerdict: "changes_requested" }),
      }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });
  });

  it("throws when there are unresolved blocker findings", async () => {
    const run = makeRun({ prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "approved",
          findings: [
            {
              id: "f1",
              severity: "blocker",
              type: "bug",
              file: "src/foo.ts",
              title: "Still broken",
              details: "d",
            },
          ],
        }),
      }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toMatchObject({
      rule: "ready_requires_blockers_resolved",
    });
  });

  it("on success: posts the ready comment and returns the run", async () => {
    const run = makeRun({ prNumber: 5, state: RunState.AIReview });
    const store = createStore(run, [
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
    ]);
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(result.id).toBe("run-1");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });
});
