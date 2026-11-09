import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeArtifact,
  wireExecutorAgent,
  wireReviewerAgent,
} from "./fixtures.js";

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const { deps, store, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(store.run.approvedPlanVersion).toBe(3);
    expect(result.state).toBe(RunState.Implementing);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(comment[1]).toBe("Plan v3 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, store, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "ship it" });

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(comment[1]).toContain("with operator note");
    expect(comment[1]).toContain("ship it");

    const approvedEvent = store.events.find((e) => e.eventType === RunEvent.PLAN_APPROVED);
    expect(approvedEvent).toBeDefined();
    expect((approvedEvent!.payloadJson as { note?: string }).note).toBe("ship it");
  });
});

describe("OrchestratorService.runExecution", () => {
  it("rejects when the run is not in Implementing state", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Todo });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: checkpoints the branch, runs the executor, and chains into an approved review", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const { deps, store, executorAgent, reviewerAgent, artifactRepo, gitService, linearClient } =
      buildStoreDeps(initialRun, [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () => makeExecutionReport({ executionVersion: 1 }), 55);
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "Great work",
      findings: [],
      overallVerdict: "approved",
    }));

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(store.run.prNumber).toBe(55);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        RunEvent.EXECUTION_STARTED,
        RunEvent.EXECUTION_FINISHED,
        RunEvent.REVIEW_APPROVED,
      ]),
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const execComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Execution Report"),
    );
    expect(execComment).toBeDefined();
  });

  it("skips the branch checkpoint when the run has no branchName", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, gitService } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () => makeExecutionReport({ executionVersion: 1 }));
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("idempotent recovery: skips re-running the executor when a stranded ExecutionReport exists and goes straight to review", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 77,
    });
    const { deps, store, executorAgent, reviewerAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    // Simulate a crash: EXECUTION_STARTED was recorded, the executor wrote its
    // report, but EXECUTION_FINISHED never got recorded. Timestamps are set
    // explicitly (rather than relying on real-clock ordering from back-to-back
    // `.create()` calls, which can land in the same millisecond) so the
    // orchestrator's createdAt comparisons are deterministic.
    const t0 = Date.now();
    store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(t0),
    });
    store.artifacts.push(
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport({ executionVersion: 1 }),
        createdAt: new Date(t0 + 1000),
      }),
    );

    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.EXECUTION_FINISHED, RunEvent.REVIEW_APPROVED]),
    );
    const finishEvent = store.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect((finishEvent!.payloadJson as { recovered?: boolean }).recovered).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED already followed the report (re-runs executor normally)", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 77,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, eventRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport({ executionVersion: 1 }),
      rawText: "{}",
    });
    await eventRepo.create({ runId: "run-1", eventType: RunEvent.EXECUTION_FINISHED, source: "executor-agent" });

    wireExecutorAgent(artifactRepo, executorAgent, () => makeExecutionReport({ executionVersion: 2 }));
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, and posts a comment instead of propagating", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, store, executorAgent, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(["EXECUTION_TIMEOUT", RunEvent.BLOCKED]),
    );
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("timed out"),
    );
    expect(comment).toBeDefined();
  });

  it("propagates non-timeout executor errors", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});
