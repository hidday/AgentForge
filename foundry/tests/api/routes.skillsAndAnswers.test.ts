import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Supplements tests/api/answer-questions.route.test.ts and
// tests/api/runsSkills.test.ts by covering a few remaining branches:
//  - answer-questions' generic (non Policy/Validation) error fallback, and
//    its non-Error-instance stringification path
//  - the skills route's `skillIds ?? []` and distillation `shouldPersist`/
//    `reason` defaulting when those fields are absent from the event payload

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
    state: RunState.HumanClarificationNeeded,
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

async function buildApp(overrides: {
  events?: unknown[];
  skills?: Record<string, unknown>;
  answerQuestionsRejection?: unknown;
} = {}) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []) };

  const skillsMap = overrides.skills ?? {};
  const mockAgentSkillRepo = {
    findById: vi.fn().mockImplementation((id: string) => Promise.resolve(skillsMap[id] ?? null)),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => mockAgentSkillRepo,
    answerQuestions:
      "answerQuestionsRejection" in overrides
        ? vi.fn().mockRejectedValue(overrides.answerQuestionsRejection)
        : vi.fn(),
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

  return { app, mockAgentSkillRepo };
}

describe("POST /api/runs/:id/actions/answer-questions — generic error fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with the message when orchestrator throws a plain Error (not Policy/Validation)", async () => {
    const { app } = await buildApp({ answerQuestionsRejection: new Error("Unexpected failure") });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unexpected failure" });
  });

  it("stringifies a non-Error rejection", async () => {
    const { app } = await buildApp({ answerQuestionsRejection: { code: "DB_DOWN" } });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: String({ code: "DB_DOWN" }) });
  });
});

describe("GET /api/runs/:id/skills — payload defaulting branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when the :id path segment is empty", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "runId is required" });
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing no skills", async () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
  });

  it("defaults shouldPersist to false and reason to empty string when absent from the payload", async () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string } | null;
    };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
  });
});
