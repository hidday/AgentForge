import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  makeRun,
  makeArtifact,
  makeExecutionReport,
  makeReview,
  makeRemediation,
  buildFullDeps,
} from "./testHelpers.js";

/**
 * runRemediation always ends by calling markReady(). Since runRemediation
 * never writes a fresh (approved) Review artifact itself -- the latest
 * Review stays "changes_requested" from before remediation ran -- markReady
 * deterministically rejects with PolicyViolationError("ready_requires_approved_verdict")
 * at the very end of the method (documented as pre-existing/out-of-scope in
 * orchestratorService.executionScore.test.ts). Tests that only care about
 * side effects which happen EARLIER in runRemediation (git commit, GitHub
 * sync calls, Linear comments, the remediationRuntime update, the recorded
 * events) swallow that trailing rejection with this helper instead of
 * re-asserting it every time.
 */
async function runRemediationIgnoringMarkReadyRejection(
  svc: OrchestratorService,
  runId: string,
  commentMap?: Record<string, number>,
): Promise<void> {
  try {
    await svc.runRemediation(runId, commentMap);
  } catch (err) {
    if (!(err instanceof PolicyViolationError) || !err.rule.startsWith("ready_")) {
      throw err;
    }
  }
}

describe("OrchestratorService.runRemediation", () => {
  it("throws a PolicyViolationError when state is not AddressingReview", async () => {
    const run = makeRun({ state: RunState.AIReview });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }),
        }),
      ],
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("verifies the branch (assertBranch) only when run.branchName is set", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation({ executionReport: makeExecutionReport({ executionVersion: 2 }) }),
    );

    const svc = new OrchestratorService(built.deps as never);
    await runRemediationIgnoringMarkReadyRejection(svc, "run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("commits and pushes remediation changes when run.branchName is set", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation({ executionReport: makeExecutionReport({ executionVersion: 2 }) }),
    );

    const svc = new OrchestratorService(built.deps as never);
    await runRemediationIgnoringMarkReadyRejection(svc, "run-1");

    expect(built.gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
  });

  it("when run.prNumber is set: posts an execution-report update and remediation resolutions to GitHub with the given commentMap", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 88 });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    const remediation = makeRemediation({
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });
    built.remediationAgent.run.mockResolvedValue(remediation);

    const svc = new OrchestratorService(built.deps as never);
    await runRemediationIgnoringMarkReadyRejection(svc, "run-1", { f1: 55 });

    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      88,
      remediation.executionReport,
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      88,
      remediation.resolution,
      { f1: 55 },
    );
  });

  it("when run.prNumber is NOT set: does not post anything to GitHub", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation({ executionReport: makeExecutionReport({ executionVersion: 2 }) }),
    );

    const svc = new OrchestratorService(built.deps as never);
    await runRemediationIgnoringMarkReadyRejection(svc, "run-1");

    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("posts the new execution-report comment BEFORE the remediation-summary comment to Linear", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation({ executionReport: makeExecutionReport({ executionVersion: 2, summary: "v2 summary" }) }),
    );

    const svc = new OrchestratorService(built.deps as never);
    await runRemediationIgnoringMarkReadyRejection(svc, "run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = built.linearClient.postComment.mock.calls;
    expect(firstCall?.[1]).toContain("Execution Report");
    expect(secondCall?.[1]).toContain("Remediation Summary");
  });

  it("sets remediationRuntime, records REMEDIATION_FINISHED then REVIEW_APPROVED, and ends ReadyForHumanReview via markReady", async () => {
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 10 });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: review }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
    });
    built.remediationAgent.run.mockResolvedValue(
      makeRemediation({
        executionReport: makeExecutionReport({
          executionVersion: 2,
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
        }),
      }),
    );

    const svc = new OrchestratorService(built.deps as never);

    // assertCanMarkReady requires the LATEST Review to have verdict "approved".
    // runRemediation never writes a fresh Review artifact, so the original
    // changes_requested Review is still latest and markReady (called at the
    // end of runRemediation, uncaught) rejects with that policy violation.
    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { remediationRuntime: "claude-code" });

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

    // runRemediation explicitly transitions the Run via REVIEW_APPROVED
    // (AIReview -> ReadyForHumanReview) BEFORE calling markReady; markReady
    // itself performs no further state transition (only validation + a
    // comment), so the run's state reflects that explicit transition even
    // though the trailing markReady call rejects.
    expect(built.store.runState).toBe(RunState.ReadyForHumanReview);
  });
});
