import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
  buildFullDeps,
} from "./testHelpers.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

/**
 * In production, ExecutorAgent/ReviewerAgent persist their own artifacts
 * (orchestratorService only reads them back via artifactRepo.findLatestByType).
 * These helpers make a mock agent "run" also write its artifact into the same
 * in-memory store used by findLatestByType, mirroring that real behavior.
 */
function wireExecutorPersistence(
  built: ReturnType<typeof buildFullDeps>,
  result: { report: ExecutionReport; prNumber: number },
) {
  built.executorAgent.run.mockImplementation(async () => {
    await built.artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: result.report.executionVersion,
      payloadJson: result.report,
      rawText: JSON.stringify(result.report),
    });
    return result;
  });
}

function wireReviewerPersistence(built: ReturnType<typeof buildFullDeps>, review: Review) {
  built.reviewerAgent.run.mockImplementation(async () => {
    await built.artifactRepo.create({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review),
    });
    return review;
  });
}

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the run is not in Implementing state", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("happy path: commits checkpoint, runs executor, persists report, transitions to AIReview, then review", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: null,
    });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });

    const report = makeExecutionReport({ filesChanged: ["src/a.ts"] });
    wireExecutorPersistence(built, { report, prNumber: 101 });
    // Make runReview's downstream policy check pass trivially by stubbing
    // reviewerAgent to return an approved verdict so execution -> review ->
    // markReady chain completes without throwing.
    wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 101, executorRuntime: "claude-code" }),
    );

    // Chained into review -> approved -> markReady -> ReadyForHumanReview
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not attempt a git checkpoint commit when run has no branchName yet", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    wireExecutorPersistence(built, { report: makeExecutionReport(), prNumber: 5 });
    wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("throws a PolicyViolationError (and does not transition) when the executor touches a protected path", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      overrides: {
        repoRegistry: {
          resolveForIssue: vi.fn(),
          resolveWorkingDirectory: vi.fn(),
          validateWorkingDirectory: vi.fn(),
          getRepoByName: vi.fn().mockReturnValue({
            name: "test-repo",
            defaultBranch: "main",
            allowedPaths: ["src/"],
            protectedPaths: ["secrets/"],
            constraints: {
              requiredChecks: [],
              maxFilesChanged: 10,
              maxDiffLines: 500,
              forbiddenPatterns: [],
              mustNotTouch: [],
            },
          }),
          getDefaultRepo: vi.fn(),
        },
      },
    });
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/key.pem"] }),
      prNumber: 9,
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    // EXECUTION_FINISHED should not have been recorded since the policy check
    // (which runs after the run+policy update) throws first.
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  describe("executor timeout handling", () => {
    it("catches AgentTimeoutError, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without throwing", async () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
      });
      const plan = makePlan({ planVersion: 1 });
      const built = buildFullDeps({
        run,
        artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      });
      built.executorAgent.run.mockRejectedValue(
        new AgentTimeoutError("executor", 1_800_000),
      );

      const svc = new OrchestratorService(built.deps as never);
      const result = await svc.runExecution("run-1");

      expect(result.state).toBe(RunState.AIBlocked);

      const eventTypes = built.eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain("EXECUTION_TIMEOUT");
      expect(eventTypes).toContain(RunEvent.BLOCKED);

      const timeoutEvent = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect(
        (timeoutEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson,
      ).toMatchObject({ agent: "executor", timeoutMs: 1_800_000 });

      expect(built.linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Executor timed out after 30 minutes"),
      );
    });

    it("re-throws non-timeout errors from the executor without special handling", async () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
      });
      const plan = makePlan({ planVersion: 1 });
      const built = buildFullDeps({
        run,
        artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      });
      built.executorAgent.run.mockRejectedValue(new Error("boom"));

      const svc = new OrchestratorService(built.deps as never);
      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");

      const eventTypes = built.eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).not.toContain("EXECUTION_TIMEOUT");
    });
  });

  describe("stranded execution recovery (crash-recovery idempotency)", () => {
    it("skips re-running the executor and records EXECUTION_FINISHED(recovered) when a report exists after the last EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 55,
        branchName: "ai/run-1",
      });
      const plan = makePlan({ planVersion: 1 });
      const report = makeExecutionReport();
      const built = buildFullDeps({
        run,
        artifacts: [
          makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
          makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
        ],
      });

      const startedAt = new Date("2026-01-01T00:00:00Z");
      built.eventRepo.findByRunId.mockResolvedValue([
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: startedAt,
        },
      ]);
      // Report's createdAt (set by makeArtifact -> new Date()) is "now", which
      // is after startedAt, satisfying reportAfterLastStart. No FINISHED event
      // exists, satisfying noFinishAfterReport.

      wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(built.deps as never);
      const result = await svc.runExecution("run-1");

      expect(built.executorAgent.run).not.toHaveBeenCalled();

      const recoveredEvent = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      );
      expect(recoveredEvent).toBeDefined();
      expect(
        (recoveredEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson,
      ).toMatchObject({ recovered: true });

      // Chains into review (approved) -> markReady -> ReadyForHumanReview
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("does NOT treat the report as stranded (and re-runs the executor) when EXECUTION_FINISHED already followed the report", async () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 55,
        branchName: "ai/run-1",
      });
      const plan = makePlan({ planVersion: 1 });
      const report = makeExecutionReport();
      const built = buildFullDeps({
        run,
        artifacts: [
          makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
          makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
        ],
      });

      const earlier = new Date("2020-01-01T00:00:00Z");
      const later = new Date("2099-01-01T00:00:00Z"); // after the report's createdAt
      built.eventRepo.findByRunId.mockResolvedValue([
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: earlier,
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: later,
        },
      ]);

      wireExecutorPersistence(built, {
        report: makeExecutionReport({ executionVersion: 2 }),
        prNumber: 55,
      });
      wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(built.deps as never);
      await svc.runExecution("run-1");

      // Since the last FINISHED is not before the report's createdAt, recovery
      // should not trigger and the executor should run normally.
      expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    });

    it("does not attempt recovery when there is no prNumber on the run yet, even if a report exists", async () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: null,
        branchName: "ai/run-1",
      });
      const plan = makePlan({ planVersion: 1 });
      const report = makeExecutionReport();
      const built = buildFullDeps({
        run,
        artifacts: [
          makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
          makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
        ],
      });
      wireExecutorPersistence(built, {
        report: makeExecutionReport({ executionVersion: 2 }),
        prNumber: 60,
      });
      wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(built.deps as never);
      await svc.runExecution("run-1");

      expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    });
  });

  it("passes an operator note through to the executor agent when provided", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    wireExecutorPersistence(built, { report: makeExecutionReport(), prNumber: 2 });
    wireReviewerPersistence(built, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1", { note: "Prefer small commits" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "Prefer small commits" },
    );
  });
});
