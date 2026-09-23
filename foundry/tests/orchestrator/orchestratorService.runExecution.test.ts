import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
} from "./_helpers/fixtures.js";

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError via PolicyEngine when run is not Implementing", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, approvedPlanVersion: 1 });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: checkpoints, runs the executor, records prNumber, transitions to AIReview, then chains into runReview", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: null,
    });
    const { deps, runRepo, artifactRepo, gitService, executorAgent, linearClient, reviewerAgent } =
      buildFullDeps(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.seed("Plan", plan);
    const report = makeExecutionReport({ filesChanged: ["src/a.ts"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(runRepo.getCurrent().prNumber).toBe(202);
    expect(runRepo.getCurrent().executorRuntime).toBe("claude-code");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    // runExecution chains into runReview -> approved -> markReady, so the run
    // ends up ReadyForHumanReview.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the git checkpoint when the run has no branchName", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, gitService, executorAgent, reviewerAgent, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when the executor touches a protected path (assertExecutorPaths)", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, repoRegistry, executorAgent, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      directory: "test-repo",
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
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["src/secrets/keys.ts"] }),
      prNumber: 202,
    });

    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  describe("crash-recovery idempotency", () => {
    it("skips the executor and jumps to runReview when an ExecutionReport already exists with no matching EXECUTION_FINISHED event", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 202,
      });
      const { deps, eventRepo, executorAgent, artifactRepo, reviewerAgent, logger } =
        buildFullDeps(run);
      artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));

      // EXECUTION_STARTED recorded well before the report was created, but the
      // process crashed before EXECUTION_FINISHED was ever recorded. Timestamps
      // are set explicitly (rather than relying on back-to-back `new Date()`
      // calls, which can collide at millisecond resolution) so the recovery
      // check's createdAt comparisons are deterministic.
      eventRepo._events.push({
        id: "evt-started",
        runId: "run-1",
        eventType: "EXECUTION_STARTED",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(Date.now() - 60_000),
      });
      artifactRepo.seed("ExecutionReport", makeExecutionReport(), { createdAt: new Date() });
      const review = makeReview({ overallVerdict: "approved" });
      reviewerAgent.run.mockResolvedValue(review);
      artifactRepo.seed("Review", review);

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        expect.stringContaining("Recovered stranded execution"),
      );
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("does NOT recover (runs the executor normally) when EXECUTION_FINISHED already followed the report", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: 202,
        branchName: null,
      });
      const { deps, eventRepo, executorAgent, artifactRepo, reviewerAgent } = buildFullDeps(run);
      artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
      artifactRepo.seed("ExecutionReport", makeExecutionReport());
      await eventRepo.create({ runId: "run-1", eventType: "EXECUTION_FINISHED", source: "executor-agent" });
      const report = makeExecutionReport();
      executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
      artifactRepo.seed("ExecutionReport", report);
      const review = makeReview({ overallVerdict: "approved" });
      reviewerAgent.run.mockResolvedValue(review);
      artifactRepo.seed("Review", review);

      const svc = new OrchestratorService(deps as never);
      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });

    it("does NOT recover when there is no prNumber on the run (even with a stranded report)", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: null,
        branchName: null,
      });
      const { deps, executorAgent, artifactRepo, reviewerAgent } = buildFullDeps(run);
      artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
      artifactRepo.seed("ExecutionReport", makeExecutionReport());
      const report = makeExecutionReport();
      executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
      artifactRepo.seed("ExecutionReport", report);
      const review = makeReview({ overallVerdict: "approved" });
      reviewerAgent.run.mockResolvedValue(review);
      artifactRepo.seed("Review", review);

      const svc = new OrchestratorService(deps as never);
      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });
  });

  describe("executor timeout handling", () => {
    it("transitions to AIBlocked, records EXECUTION_TIMEOUT, and posts a comment without throwing", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: null,
      });
      const { deps, runRepo, executorAgent, eventRepo, linearClient, logger, artifactRepo } =
        buildFullDeps(run);
      artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
      executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runExecution("run-1");

      expect(result.state).toBe(RunState.AIBlocked);
      expect(logger.error).toHaveBeenCalled();
      const timeoutEvent = eventRepo._events.find((e) => e.eventType === "EXECUTION_TIMEOUT");
      expect(timeoutEvent).toBeDefined();
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Executor timed out"),
      );
      expect(runRepo.getCurrent().state).toBe(RunState.AIBlocked);
    });

    it("re-throws non-timeout errors from the executor", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        branchName: null,
      });
      const { deps, executorAgent, artifactRepo } = buildFullDeps(run);
      artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
      executorAgent.run.mockRejectedValue(new Error("boom"));

      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    });
  });

  it("passes an operatorNote through to executorAgent.run when provided", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1", { note: "focus on the retry logic" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: null, existingPR: null }),
      { operatorNote: "focus on the retry logic" },
    );
  });
});
