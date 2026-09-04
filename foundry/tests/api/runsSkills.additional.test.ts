import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

/**
 * Additional coverage for GET /api/runs/:id/skills beyond runsSkills.test.ts:
 * the `skillIds ?? []` fallback when a SKILL_INJECTION event's payload omits
 * skillIds, and the `shouldPersist ?? false` / `reason ?? ""` fallbacks when
 * a SKILL_DISTILLATION event's payload omits those fields.
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

async function buildApp(events: unknown[]) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(events), create: vi.fn() };
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

describe("GET /api/runs/:id/skills (additional coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing zero skills", async () => {
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
    const { app } = await buildApp(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().injectedSkills).toEqual([]);
  });

  it("defaults shouldPersist to false and reason to empty string when the distillation payload omits them", async () => {
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
});
