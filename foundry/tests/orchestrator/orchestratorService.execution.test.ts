import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
} from "./orchestratorServiceTestHelpers.js";

function runInImplementing(overrides: Record<string, unknown> = {}) {
  return makeRun({
    state: RunState.Implementing,
    approvedPlanVersion: 1,
    branchName: "ai/run-1",
    prNumber: null,
    ...overrides,
  });
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor, records the PR, and proceeds to code review on success", async () => {
    const { deps, runRepo, executorAgent, linearClient } = buildDeps({}, runInImplementing());
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 42, executorRuntime: "claude-code" }),
    );
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("checkpoints the branch before running the executor when one already exists", async () => {
    const { deps, gitService } = buildDeps({}, runInImplementing());
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/run-1", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalled();
  });

  it("recovers a stranded execution report without re-running the executor", async () => {
    const run = runInImplementing({ prNumber: 7 });
    const { deps, artifactRepo, eventRepo, executorAgent } = buildDeps({}, run);
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: report,
            createdAt: new Date("2024-02-01T00:00:00Z"),
          }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("does not recover when EXECUTION_FINISHED already fired after the report", async () => {
    const run = runInImplementing({ prNumber: 7 });
    const { deps, artifactRepo, eventRepo, executorAgent } = buildDeps({}, run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: makeExecutionReport(),
            createdAt: new Date("2024-01-01T00:00:00Z"),
          }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2023-12-01T00:00:00Z"),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date("2024-02-01T00:00:00Z"),
      },
    ]);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
  });

  it("pauses the run and notifies Linear when the executor times out", async () => {
    const { deps, executorAgent, eventRepo, linearClient } = buildDeps({}, runInImplementing());
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("timed out"),
    );
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("propagates non-timeout executor errors", async () => {
    const { deps, executorAgent } = buildDeps({}, runInImplementing());
    executorAgent.run.mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("rejects when the run is not in the Implementing state", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
  });
});
