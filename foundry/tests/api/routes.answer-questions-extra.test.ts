import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

/**
 * Covers the answer-questions route's generic error fallback: when
 * orchestrator.answerQuestions rejects with something that is neither a
 * PolicyError, a ValidationError, nor even an Error instance.
 */
async function buildApp() {
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
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/answer-questions — generic error fallback", () => {
  it("returns 400 with a stringified message when the rejection is a plain Error not covered by the specific branches", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("Unexpected database error"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unexpected database error" });
  });

  it("stringifies a non-Error rejection via String(err)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    mockOrchestrator.answerQuestions.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});
