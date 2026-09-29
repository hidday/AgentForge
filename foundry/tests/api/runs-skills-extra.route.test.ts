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

async function buildApp(events: unknown[] = []) {
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

describe("GET /api/runs/:id/skills — extra branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the run id path segment is empty", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "runId is required" });
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing zero skill ids", async () => {
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
    const { app, mockAgentSkillRepo } = await buildApp(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
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
    const { app } = await buildApp(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: {
        shouldPersist: boolean;
        reason: string;
        taskCategory: string | null;
        name: string | null;
        description: string | null;
        displacedSkillId: string | null;
      } | null;
    };
    expect(body.distillationDecision).toEqual({
      shouldPersist: false,
      reason: "",
      taskCategory: null,
      name: null,
      description: null,
      displacedSkillId: null,
    });
  });

  it("does not attempt skill lookups when shouldPersist is false, even with a taskCategory present", async () => {
    const events = [
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: { shouldPersist: false, taskCategory: "auth" },
        createdAt: new Date(),
      },
    ];
    const { app, mockAgentSkillRepo } = await buildApp(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { distilledSkill: unknown };
    expect(body.distilledSkill).toBeNull();
    expect(mockAgentSkillRepo.findByRepoCategoryNearTime).not.toHaveBeenCalled();
  });
});
