import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makeExecutionReport,
  makePlan,
  makeRun,
} from "./testSupport.js";

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the run is not in the Implementing state", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("throws a PolicyViolationError when the plan version doesn't match approvedPlanVersion", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "execute_plan_version_mismatch",
    });
  });

  it("recovers a stranded execution: skips the executor and jumps straight to review when an ExecutionReport exists without a matching EXECUTION_FINISHED", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      prNumber: 99,
      branchName: "ai/run-1",
    });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date("2026-02-01T00:00:02Z"),
      }),
    ]);
    store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: null,
      createdAt: new Date("2026-02-01T00:00:01Z"),
    });

    const { deps, executorAgent, logger } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 99 }),
      expect.stringContaining("Recovered stranded execution"),
    );

    const finishedEvent = store.events.find(
      (e) => e.eventType === (RunEvent.EXECUTION_FINISHED as string),
    );
    expect(finishedEvent).toBeDefined();
    expect((finishedEvent!.payloadJson as { recovered: boolean }).recovered).toBe(true);
  });

  it("does NOT recover (runs the executor normally) when EXECUTION_FINISHED already followed the ExecutionReport", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      prNumber: 99,
      branchName: null,
    });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date("2026-02-01T00:00:01Z"),
      }),
    ]);
    store.events.push({
      id: "evt-finished",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_FINISHED,
      source: "executor-agent",
      payloadJson: null,
      createdAt: new Date("2026-02-01T00:00:02Z"),
    });

    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ executionVersion: 2 }),
      prNumber: 99,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does NOT attempt recovery when the run has no prNumber, even with an existing ExecutionReport", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      prNumber: null,
      branchName: null,
    });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ executionVersion: 2 }),
      prNumber: 100,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("asserts the branch and commits a WIP checkpoint before invoking the executor when branchName is set", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      workingDirectory: "/tmp/worktree",
    });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, gitService, executorAgent } = buildDeps(store);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 5 });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
  });

  it("skips the branch checkpoint when branchName is not set", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, gitService, executorAgent } = buildDeps(store);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 5 });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to BLOCKED with a minute-rounded reason, posts a comment, and does not call runReview", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient, eventRepo } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 5 * 60_000));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(runReviewSpy).not.toHaveBeenCalled();

    const timeoutEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent![0] as { payloadJson: { timeoutMs: number } }).payloadJson.timeoutMs).toBe(
      5 * 60_000,
    );

    const blockedEvent = store.events.find((e) => e.eventType === (RunEvent.BLOCKED as string));
    expect((blockedEvent!.payloadJson as { reason: string }).reason).toContain(
      "Executor timed out after 5m",
    );

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Executor timed out"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("5 minutes");
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("executor crashed"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
  });

  it("throws a PolicyViolationError when the executor touches a protected path", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, repoRegistry } = buildDeps(store);
    repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["infra/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["infra/deploy.yml"] }),
      prNumber: 5,
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "executor_touched_protected_path",
    });
  });

  it("on success: updates run with prNumber/executorRuntime, transitions EXECUTION_FINISHED, posts the report comment, and delegates to runReview", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const report = makeExecutionReport({ executionVersion: 1, score: 0.87 });
    executorAgent.run.mockResolvedValue({ report, prNumber: 77 });
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(store.run.prNumber).toBe(77);
    expect(store.run.executorRuntime).toBe("claude-code");
    const finishedEvent = store.events.find(
      (e) => e.eventType === (RunEvent.EXECUTION_FINISHED as string),
    );
    expect(finishedEvent).toBeDefined();
    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("Execution Report");
    expect(comment).toContain("87%");
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("passes opts.note through to executorAgent.run as an operatorNote", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 5 });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1", { note: "focus on error handling" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: null, existingPR: null }),
      { operatorNote: "focus on error handling" },
    );
  });
});
