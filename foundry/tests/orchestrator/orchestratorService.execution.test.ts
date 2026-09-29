import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  stubExecutor,
  stubReviewer,
} from "./helpers/testKit.js";

describe("OrchestratorService.approvePlan", () => {
  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 2,
      payloadJson: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(2);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 2,
      payloadJson: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.approvePlan("run-1", { note: "prioritize security" });

    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("prioritize security"),
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

function seedApprovedPlan(h: ReturnType<typeof buildStorefulDeps>, planVersion = 1) {
  return h.artifactRepo.create({
    runId: h.store.run.id,
    type: "Plan",
    version: planVersion,
    payloadJson: makePlan({ planVersion }),
  });
}

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the plan version does not match the approved version", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
    });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 2); // mismatched version

    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("runs the executor, persists prNumber, transitions to AIReview, and proceeds to code review", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);

    stubExecutor(h, makeExecutionReport(), 42);
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runExecution("run-1");

    expect(h.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
    expect(h.store.run.prNumber).toBe(42);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the branch checkpoint commit when the run has no branchName", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);
    stubExecutor(h, makeExecutionReport(), 7);
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runExecution("run-1");

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining("checkpoint"),
    );
  });

  it("enforces policy on executor-changed paths (protected path violation)", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);
    h.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    stubExecutor(h, makeExecutionReport({ filesChanged: ["src/secrets/keys.ts"] }), 1);

    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    // The run should NOT have progressed to code review since the policy check
    // runs before the EXECUTION_FINISHED transition.
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  describe("crash recovery / idempotency", () => {
    it("skips re-running the executor and proceeds straight to review when a stranded ExecutionReport is detected", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 99,
      });
      const h = buildStorefulDeps(run);
      await seedApprovedPlan(h, 1);

      // Existing ExecutionReport, and an EXECUTION_STARTED event but no
      // EXECUTION_FINISHED after it -- simulates a crash between artifact
      // persistence and the state transition. Timestamps are set explicitly
      // (rather than relying on `new Date()` ordering across fast, sequential
      // awaits) so the "report created after last EXECUTION_STARTED" check is
      // unambiguous.
      h.store.events.push({
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      h.store.artifacts.push({
        id: "artifact-report-1",
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        rawText: "{}",
        createdAt: new Date("2026-01-01T00:01:00Z"),
      });

      stubReviewer(h, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(h.deps as never);
      const result = await svc.runExecution("run-1");

      expect(h.executorAgent.run).not.toHaveBeenCalled();
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", prNumber: 99 }),
        expect.stringContaining("Recovered stranded execution"),
      );
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("does NOT treat the report as stranded when EXECUTION_FINISHED already followed it (re-runs executor normally)", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 99,
      });
      const h = buildStorefulDeps(run);
      await seedApprovedPlan(h, 1);

      h.store.events.push({
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      h.store.artifacts.push({
        id: "artifact-report-1",
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        rawText: "{}",
        createdAt: new Date("2026-01-01T00:01:00Z"),
      });
      h.store.events.push({
        id: "evt-finished",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:02:00Z"),
      });

      stubExecutor(h, makeExecutionReport({ executionVersion: 2 }), 99);
      stubReviewer(h, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(h.deps as never);
      await svc.runExecution("run-1");

      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    });

    it("does NOT treat the report as stranded when the run has no prNumber yet", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: null,
      });
      const h = buildStorefulDeps(run);
      await seedApprovedPlan(h, 1);
      await h.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
      });

      stubExecutor(h, makeExecutionReport({ executionVersion: 2 }), 55);
      stubReviewer(h, makeReview({ overallVerdict: "approved" }));

      const svc = new OrchestratorService(h.deps as never);
      await svc.runExecution("run-1");

      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("executor timeout handling", () => {
    it("blocks the run and posts a comment when the executor times out", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
      });
      const h = buildStorefulDeps(run);
      await seedApprovedPlan(h, 1);
      h.executorAgent.run.mockRejectedValue(
        new AgentTimeoutError("executor", 30 * 60_000),
      );

      const svc = new OrchestratorService(h.deps as never);
      const result = await svc.runExecution("run-1");

      expect(result.state).toBe(RunState.AIBlocked);
      const eventTypes = h.store.events.map((e) => e.eventType);
      expect(eventTypes).toContain("EXECUTION_TIMEOUT");
      expect(h.linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Executor timed out after 30 minutes"),
      );
      expect(h.reviewerAgent.run).not.toHaveBeenCalled();
    });

    it("rethrows non-timeout errors from the executor", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
      });
      const h = buildStorefulDeps(run);
      await seedApprovedPlan(h, 1);
      const boom = new Error("executor exploded");
      h.executorAgent.run.mockRejectedValue(boom);

      const svc = new OrchestratorService(h.deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow("executor exploded");
    });
  });

  it("forwards an operator note to the executor agent", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const h = buildStorefulDeps(run);
    await seedApprovedPlan(h, 1);
    stubExecutor(h, makeExecutionReport(), 1);
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runExecution("run-1", { note: "focus on the retry path" });

    expect(h.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: run.branchName, existingPR: run.prNumber }),
      { operatorNote: "focus on the retry path" },
    );
  });
});
