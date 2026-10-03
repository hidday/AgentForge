import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
} from "./_fixtures.js";

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError and never invokes the executor when run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("transitions to AIBlocked and posts a comment when the executor times out", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, eventRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }));
      return Promise.resolve(null);
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);

    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent![0] as { payloadJson: { agent: string; timeoutMs: number } }).payloadJson).toEqual({
      agent: "executor",
      timeoutMs: 600_000,
    });

    const blockedComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(blockedComment).toBeDefined();
    expect(blockedComment![1]).toContain("10 minutes");
  });

  it("rethrows a non-timeout error raised by the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("rejects when the executor touches a protected path, after the report/prNumber have been persisted", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
    (deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
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

    const report = makeExecutionReport({ filesChanged: ["infra/main.tf"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 99 });
    runRepo.update.mockResolvedValue(makeRun({ prNumber: 99 }));

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    // The PR number/executorRuntime update happens BEFORE the path check.
    expect(runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 99,
      executorRuntime: "claude-code",
    });
  });

  it("recovers a stranded execution (ExecutionReport exists, no EXECUTION_FINISHED recorded) without re-running the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
      prNumber: 55,
    });
    runRepo.findById.mockResolvedValue(run);

    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2026-01-01T00:10:00Z"),
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const fakeReviewResult = makeRun({ state: RunState.ReadyForHumanReview });
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(fakeReviewResult);

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");

    const recoveredEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect(
      (recoveredEvent![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered,
    ).toBe(true);

    expect(result).toBe(fakeReviewResult);
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED was already recorded after the report", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
      prNumber: 55,
    });
    runRepo.findById.mockResolvedValue(run);

    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    // A finish event already recorded AFTER the report -- not a stranded state.
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:06:00Z"),
      },
    ]);

    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 55 });
    runRepo.update.mockResolvedValue(makeRun({ prNumber: 55, state: RunState.Implementing }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("happy path: commits a WIP checkpoint, runs the executor, records EXECUTION_FINISHED, and proceeds to review", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 2,
      branchName: "ai/run-1",
    });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 2 }) }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });

    const report = makeExecutionReport({ filesChanged: ["src/a.ts"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    runRepo.update.mockResolvedValue(makeRun({ prNumber: 101, state: RunState.Implementing }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 101 }));

    const fakeReviewResult = makeRun({ state: RunState.ReadyForHumanReview });
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(fakeReviewResult);

    const result = await svc.runExecution("run-1");

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 101,
      executorRuntime: "claude-code",
    });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Execution Report"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(fakeReviewResult);
  });
});
