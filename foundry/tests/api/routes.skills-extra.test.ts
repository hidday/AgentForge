import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the branches of GET /api/runs/:id/skills where orchestrator.getAgentSkillRepo()
// returns null/undefined (e.g. agent-skill persistence is not configured) even though
// SKILL_INJECTION / SKILL_DISTILLATION events are present on the run.

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

async function buildApp(events: unknown[], agentSkillRepo: unknown = null) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(makeRun()),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(events) };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(agentSkillRepo),
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

  return { app };
}

describe("GET /api/runs/:id/skills (agentSkillRepo not configured)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty injectedSkills array when SKILL_INJECTION events exist but there is no agentSkillRepo", async () => {
    const { app } = await buildApp([
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-id-1"] },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
  });

  it("returns distillationDecision without a distilledSkill lookup when shouldPersist is true but there is no agentSkillRepo", async () => {
    const { app } = await buildApp([
      {
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: true,
          reason: "architectural insight",
          taskCategory: "auth middleware",
          skillId: "some-skill-id",
          displacedSkillId: null,
        },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: { shouldPersist: boolean } | null;
      distilledSkill: unknown;
    };
    expect(body.distillationDecision?.shouldPersist).toBe(true);
    expect(body.distilledSkill).toBeNull();
  });

  it("defaults a SKILL_INJECTION event's skillIds to an empty set when the field is absent", async () => {
    const mockAgentSkillRepo = {
      findById: vi.fn(),
      findByRepoCategoryNearTime: vi.fn(),
    };
    const { app } = await buildApp(
      [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
      mockAgentSkillRepo,
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when the SKILL_DISTILLATION payload omits them", async () => {
    const mockAgentSkillRepo = {
      findById: vi.fn(),
      findByRepoCategoryNearTime: vi.fn(),
    };
    const { app } = await buildApp(
      [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
      mockAgentSkillRepo,
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { distillationDecision: { shouldPersist: boolean; reason: string } | null };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });
});
