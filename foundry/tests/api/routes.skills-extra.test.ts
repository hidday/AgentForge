import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Supplemental branch coverage for GET /api/runs/:id/skills, beyond what
// tests/api/runsSkills.test.ts already exercises (not modified here).

function makeRun(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

async function buildApp(overrides: { events?: unknown[]; run?: unknown | null } = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(overrides.run === undefined ? makeRun() : overrides.run),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []) };

  const mockAgentSkillRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
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
  return { app, mockAgentSkillRepo, mockRunRepo };
}

describe("GET /api/runs/:id/skills (extra branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the runId path segment is empty", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "runId is required" });
  });

  it("defaults to an empty skillIds list when a SKILL_INJECTION event omits the field", async () => {
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
    const { app, mockAgentSkillRepo } = await buildApp({ events });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when the distillation payload omits them", async () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {
          // shouldPersist and reason deliberately omitted to exercise the
          // `?? false` / `?? ""` fallbacks.
          taskCategory: null,
          displacedSkillId: null,
        },
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { distillationDecision: { shouldPersist: boolean; reason: string } };
    expect(body.distillationDecision?.shouldPersist).toBe(false);
    expect(body.distillationDecision?.reason).toBe("");
  });

  it("leaves distilledSkill null when the fallback run lookup does not find the run", async () => {
    const eventTime = new Date("2026-06-08T16:26:58.000Z");
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: true,
          reason: "architectural insight",
          taskCategory: "auth middleware",
          displacedSkillId: null,
        },
        createdAt: eventTime,
      },
    ];
    const { app, mockAgentSkillRepo, mockRunRepo } = await buildApp({ events });
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { distilledSkill: unknown };
    expect(body.distilledSkill).toBeNull();
    expect(mockAgentSkillRepo.findByRepoCategoryNearTime).not.toHaveBeenCalled();
  });
});
