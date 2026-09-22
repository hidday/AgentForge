import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

/**
 * Extra coverage for GET /api/runs/:id/skills — branches not exercised by
 * tests/api/runsSkills.test.ts: missing runId, SKILL_INJECTION events with
 * no skillIds field, and SKILL_DISTILLATION payloads missing
 * shouldPersist/reason.
 */

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
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
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

describe("GET /api/runs/:id/skills — extra branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when runId path segment is empty", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "runId is required" });
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing no ids", async () => {
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

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to empty string when absent from the distillation payload", async () => {
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
