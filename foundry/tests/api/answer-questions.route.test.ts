import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state = RunState.HumanClarificationNeeded) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state,
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
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

describe("POST /api/runs/:id/actions/answer-questions", () => {
  it("returns 200 for valid body in HumanClarificationNeeded state", async () => {
    const run = makeRun(RunState.HumanClarificationNeeded);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: {
        answers: [{ questionId: "q1", answer: "yes" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; run: typeof run };
    expect(body.ok).toBe(true);
    expect(body.run).toBeDefined();
  });

  it("returns 200 for valid body in AwaitingPlanApproval state", async () => {
    const run = makeRun(RunState.AwaitingPlanApproval);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: {
        answers: [{ questionId: "q1", answer: "optional answer" }],
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 when answers is missing", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 400 when answers is an empty array", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when answer item is missing questionId", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when answer item has empty questionId", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when orchestrator throws ValidationError (unrecognised questionId)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(
      new ValidationError("Unrecognised questionId: \"unknown\""),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "unknown", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("Unrecognised questionId");
  });

  it("returns 400 when orchestrator throws ValidationError (missing required answers)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(
      new ValidationError("Missing answers for required questions: q2"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("Missing answers");
  });

  it("returns 409 when orchestrator throws PolicyError (wrong state)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(
      new PolicyError("Wrong state: Planning"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("Wrong state");
  });
});
