import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun() {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
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

async function buildApp(overrides: { events?: unknown[] } = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(makeRun()),
    findAll: vi.fn(),
    findMissingTitles: vi.fn(),
  };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []),
    create: vi.fn(),
  };
  const mockAgentSkillRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => mockAgentSkillRepo,
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
    runManualReReview: vi.fn(),
    startRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    getLinearClient: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();
  return { app };
}

describe("GET /api/runs/:id/skills — field-level fallback branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the :id route param resolves to an empty string", async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "runId is required" });
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing zero ids", async () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ];

    const { app } = await buildApp({ events });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toHaveLength(0);
  });

  it("falls back to shouldPersist=false and reason='' when a SKILL_DISTILLATION payload omits them", async () => {
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
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string } | null;
    };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
  });
});
