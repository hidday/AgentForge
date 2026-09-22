import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

/**
 * Extra coverage for POST /api/runs/:id/actions/answer-questions — the
 * generic-error fallback branch (an error that is neither a PolicyError
 * nor a ValidationError) not exercised by
 * tests/api/answer-questions.route.test.ts.
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

describe("POST /api/runs/:id/actions/answer-questions — extra branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with the error message when a plain (non-Policy/Validation) Error is thrown", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("Unexpected DB failure"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Unexpected DB failure" });
  });

  it("returns 400 with a stringified message when a non-Error value is thrown", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("plain string failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "plain string failure" });
  });
});
