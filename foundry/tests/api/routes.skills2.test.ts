import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Fills gaps in tests/api/runsSkills.test.ts (which always provides a
// non-null agentSkillRepo): the "no agentSkillRepo" branch, the empty
// :id param branch, and the distillation payload's ?? fallback defaults.

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

async function buildApp(opts: { events?: unknown[]; agentSkillRepo?: unknown } = {}) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(opts.events ?? []) };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(opts.agentSkillRepo ?? null),
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

describe("GET /api/runs/:id/skills — additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty injectedSkills when there is no agentSkillRepo even though injection events exist", async () => {
    const events = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-x"] },
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events, agentSkillRepo: null });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
  });

  it("returns no distilledSkill when shouldPersist is true but there is no agentSkillRepo", async () => {
    const events = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: { shouldPersist: true, taskCategory: "auth" },
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events, agentSkillRepo: null });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distilledSkill: unknown;
      distillationDecision: { reason: string; name: string | null; displacedSkillId: string | null };
    };
    expect(body.distilledSkill).toBeNull();
    // The ?? fallback defaults should fill in the missing optional fields.
    expect(body.distillationDecision).toMatchObject({
      shouldPersist: true,
      reason: "",
      name: null,
      description: null,
      displacedSkillId: null,
    });
  });

  it("returns 400 when the :id route param is empty", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
  });
});
