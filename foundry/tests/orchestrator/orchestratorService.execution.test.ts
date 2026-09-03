import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import { buildDeps, makeStore, pushArtifact, type Store } from "./helpers/fixtures.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function setupImplementingRun(store: Store) {
  store.run = { ...store.run, state: RunState.Implementing, approvedPlanVersion: 1, planVersion: 1 };
  pushArtifact(store, "Plan", 1, makePlan({ planVersion: 1 }));
}

describe("OrchestratorService.runExecution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the executor, persists the report, transitions to AIReview, and delegates to runReview", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const report = makeExecutionReport();
    built.executorAgent.run.mockResolvedValue({ report, prNumber: 55 });

    const finalRun = { ...store.run, state: RunState.ReadyForHumanReview };
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finalRun as never);

    const result = await svc.runExecution("run-1");

    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator" }),
    );
    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ repo: expect.objectContaining({ name: "test-repo" }) }),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 55, executorRuntime: "claude-code" }),
    );

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );

    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("passes opts.note through as operatorNote to the executor", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 10 });
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1", { note: "focus on the retry path" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on the retry path" },
    );
  });

  it("skips git commit/push checkpoint when the run has no branchName", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    store.run.branchName = null;
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 10 });
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("commits a WIP checkpoint before the executor runs when the run has a branchName", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 10 });
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
  });

  it("propagates an assertExecutorPaths policy violation (e.g. protected path touched) without transitioning state", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    built.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["protected/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    const svc = new OrchestratorService(built.deps as never);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["protected/secret.ts"] }),
      prNumber: 10,
    });

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);

    // runRepo.update (prNumber/executorRuntime) happens before the policy check,
    // so it should still have been recorded even though we ultimately reject.
    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 10 }),
    );
    // But the EXECUTION_FINISHED transition never happened.
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  describe("stranded execution recovery", () => {
    it("skips re-running the executor when an ExecutionReport exists after the last EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
      const store = makeStore();
      setupImplementingRun(store);
      store.run.prNumber = 77;
      store.events.push({
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      pushArtifact(store, "ExecutionReport", 1, makeExecutionReport());
      store.artifacts[store.artifacts.length - 1]!.createdAt = new Date("2026-01-01T00:00:05Z");

      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);
      const finalRun = { ...store.run, state: RunState.ReadyForHumanReview };
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finalRun as never);

      const result = await svc.runExecution("run-1");

      expect(built.executorAgent.run).not.toHaveBeenCalled();
      const recoveredCall = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      );
      expect(recoveredCall).toBeDefined();
      expect((recoveredCall![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
        true,
      );
      expect(built.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", prNumber: 77 }),
        expect.stringContaining("Recovered stranded execution"),
      );
      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
      expect(result).toBe(finalRun);
    });

    it("does NOT treat the run as stranded when there is no prNumber yet", async () => {
      const store = makeStore();
      setupImplementingRun(store);
      store.run.prNumber = null;
      store.events.push({
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      pushArtifact(store, "ExecutionReport", 1, makeExecutionReport());

      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);
      built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 99 });
      vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

      await svc.runExecution("run-1");

      expect(built.executorAgent.run).toHaveBeenCalled();
    });

    it("does NOT treat the run as stranded when EXECUTION_FINISHED was already recorded after the report", async () => {
      const store = makeStore();
      setupImplementingRun(store);
      store.run.prNumber = 77;
      pushArtifact(store, "ExecutionReport", 1, makeExecutionReport());
      store.artifacts[store.artifacts.length - 1]!.createdAt = new Date("2026-01-01T00:00:00Z");
      store.events.push(
        {
          id: "evt-started",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date("2025-12-31T23:59:00Z"),
        },
        {
          id: "evt-finished",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: new Date("2026-01-01T00:00:10Z"),
        },
      );

      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);
      built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 99 });
      vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

      await svc.runExecution("run-1");

      expect(built.executorAgent.run).toHaveBeenCalled();
    });
  });

  describe("executor timeout handling", () => {
    it("catches AgentTimeoutError, records EXECUTION_TIMEOUT, transitions to AIBlocked, and posts a comment without calling runReview", async () => {
      const store = makeStore();
      setupImplementingRun(store);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);
      const timeoutErr = new AgentTimeoutError("executor", 30 * 60_000);
      built.executorAgent.run.mockRejectedValue(timeoutErr);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      const result = await svc.runExecution("run-1");

      expect(built.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", timeoutMs: 30 * 60_000, agent: "executor" }),
        expect.stringContaining("timed out"),
      );
      const timeoutEventCall = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect(timeoutEventCall).toBeDefined();
      expect(result.state).toBe(RunState.AIBlocked);
      expect(built.linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Executor timed out after 30 minutes"),
      );
      expect(runReviewSpy).not.toHaveBeenCalled();
    });

    it("rethrows any non-timeout error from the executor", async () => {
      const store = makeStore();
      setupImplementingRun(store);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);
      built.executorAgent.run.mockRejectedValue(new Error("boom"));

      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    });
  });
});
