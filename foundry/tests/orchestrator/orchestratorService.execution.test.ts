import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
} from "./orchestratorTestHelpers.js";

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records the approved plan version and transitions to Implementing", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approvePlan("run-1");

    expect(run.state).toBe(RunState.Implementing);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 1 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("includes the operator note in the approval comment when given", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "ship it" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("ship it"),
    );
  });
});

describe("OrchestratorService.runExecution", () => {
  it("recovers a stranded execution when a report exists but EXECUTION_FINISHED was never recorded", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, prNumber: 7, approvedPlanVersion: 1 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport(), createdAt: new Date("2026-01-02") }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "EXECUTION_STARTED",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01"),
      },
    ]);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = await svc.runExecution("run-1");

    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AIReview);
  });

  it("does not take the recovery path when EXECUTION_FINISHED already fired after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, prNumber: 7, approvedPlanVersion: 1 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport(), createdAt: new Date("2026-01-01") }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "EXECUTION_FINISHED", source: "x", payloadJson: {}, createdAt: new Date("2026-01-02") },
    ]);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("checkpoints the branch and runs the executor on the happy path, then proceeds to review", async () => {
    const { deps, runRepo, gitService, executorAgent, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, branchName: "ai/run-1", approvedPlanVersion: 1 }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = await svc.runExecution("run-1");

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/run-1",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 42, executorRuntime: "claude-code" });
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Execution Report"));
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(run.state).toBe(RunState.AIReview);
  });

  it("skips the git checkpoint when the run has no branch yet", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("pauses the run with BLOCKED when the executor agent times out", async () => {
    const { deps, runRepo, executorAgent, eventRepo, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }));
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 60_000));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runExecution("run-1");

    expect(run.state).toBe(RunState.AIBlocked);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
  });

  it("rethrows a non-timeout error from the executor agent", async () => {
    const { deps, runRepo, executorAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }));
    executorAgent.run.mockRejectedValue(new Error("unexpected crash"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("unexpected crash");
  });

  it("rejects when the run is not in the Implementing state", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
  });
});
