import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Gap-fillers for GET /api/runs/:id/skills, complementing
// tests/api/runsSkills.test.ts (which covers the main branches). These
// cover the default-value fallbacks that the existing fixtures never
// exercise: a SKILL_INJECTION event with no skillIds array, and a
// SKILL_DISTILLATION event missing shouldPersist/reason.

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

async function buildApp(events: unknown[]) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(events) };

  const mockAgentSkillRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => mockAgentSkillRepo,
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

describe("GET /api/runs/:id/skills (default-value branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a SKILL_INJECTION event with no skillIds as contributing no ids", async () => {
    const { app, mockAgentSkillRepo } = await buildApp([
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 400 when the :id segment is empty (e.g. a //skills URL)", async () => {
    const { app } = await buildApp([]);

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "runId is required" });
  });

  it("defaults shouldPersist to false and reason to '' when the distillation payload omits them", async () => {
    const { app } = await buildApp([
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string } | null;
      distilledSkill: unknown;
    };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
    expect(body.distilledSkill).toBeNull();
  });
});
