import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
  buildFullDeps,
} from "./testHelpers.js";

describe("OrchestratorService.runReview", () => {
  it("throws a PolicyViolationError when the run is not in AIReview state", async () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("fetches the PR diff and calls reviewerAgent with plan, report, diff, and bundle", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });
    built.githubClient.getPRDiff.mockResolvedValue("diff --git a/x b/x");
    const approvedReview = makeReview({ overallVerdict: "approved" });
    built.reviewerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: approvedReview,
        rawText: "{}",
      });
      return approvedReview;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 7);
    expect(built.reviewerAgent.run).toHaveBeenCalledWith(
      plan,
      report,
      "diff --git a/x b/x",
      expect.anything(),
      "run-1",
    );
  });

  it("assertCanReview rejects before any diff fetch when the run has no PR number", async () => {
    // assertCanReview requires run.prNumber, so runReview never reaches the
    // `run.prNumber ? getPRDiff(...) : ""` branch without one -- confirms the
    // PR-existence policy check runs first.
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow("Cannot review without an existing PR");

    expect(built.githubClient.getPRDiff).not.toHaveBeenCalled();
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("verdict=approved: transitions to ReadyForHumanReview via REVIEW_APPROVED, does not post findings, calls markReady", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });
    const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });
    built.reviewerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: approvedReview,
        rawText: "{}",
      });
      return approvedReview;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(eventTypes).not.toContain(RunEvent.REVIEW_CHANGES_REQUESTED);

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });

  it("verdict=changes_requested with findings and a PR: posts findings to GitHub and builds a commentMap passed into remediation", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });
    const changesReview = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    built.reviewerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: changesReview,
        rawText: "{}",
      });
      return changesReview;
    });
    built.githubSync.postReviewFindings.mockResolvedValue(
      new Map<string, number>([["f1", 123]]),
    );
    // runRemediation will be invoked next; stub its prerequisites to avoid it
    // throwing inside this test (we only assert the commentMap argument).
    built.remediationAgent.run.mockImplementation(async () => {
      throw new Error("remediation-not-under-test");
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow("remediation-not-under-test");

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      changesReview.findings,
      "changes_requested",
    );
  });

  it("verdict=changes_requested with zero findings: does not post findings to GitHub even with a PR, and still chains into remediation (which then rejects on policy)", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });
    const changesReview = makeReview({ overallVerdict: "changes_requested", findings: [] });
    built.reviewerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: changesReview,
        rawText: "{}",
      });
      return changesReview;
    });

    const svc = new OrchestratorService(built.deps as never);
    // runRemediation's own policy check (assertCanRemediate) requires at
    // least one finding, so the chained call surfaces that instead.
    await expect(svc.runReview("run-1")).rejects.toThrow(
      "Cannot remediate without review findings",
    );

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(built.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("sets reviewerRuntime to 'codex' on the run", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
    });
    built.reviewerAgent.run.mockImplementation(async () => {
      const review = makeReview({ overallVerdict: "approved" });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: "{}",
      });
      return review;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runReview("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
  });
});
