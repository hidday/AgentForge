import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// A handful of routes kick off a long-running orchestrator call
// "fire-and-forget" (they don't await it before responding) and normalize
// any rejection with `err instanceof Error ? err.message : String(err)` in
// a logError callback. The synchronous try/catch branches for these routes
// are covered elsewhere; these tests specifically drive the *asynchronous*
// .catch(logError) path with a non-Error rejection.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("routes.ts fire-and-forget non-Error rejection branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve-plan: stringifies a non-Error rejection from the background runExecution call", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue("execution blew up (plain string)");
    const errorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "execution blew up (plain string)" }),
      "Execution failed",
    );
  });

  it("re-review-plan: stringifies a non-Error rejection from the background runManualReReview call", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(123);
    const errorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "123" }),
      "Manual re-review failed",
    );
  });

  it("revise-plan: stringifies a non-Error rejection from the background runManualPlanRevision call", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue({ code: "E_BAD" });
    const errorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "[object Object]" }),
      "Manual plan revision failed",
    );
  });

  it("answer-questions: stringifies a non-Error, non-PolicyError, non-ValidationError rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("plain rejection reason");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain rejection reason" });
  });

  it("answer-questions: uses .message for a generic Error rejection that isn't PolicyError/ValidationError", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("unexpected orchestrator failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unexpected orchestrator failure" });
  });

  it("retry: stringifies a non-Error rejection from the background trigger via the shared logError helper", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue(999);
    const errorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });
    expect(res.statusCode).toBe(200);

    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "999" }),
      "Retry stage failed",
    );
  });
});
