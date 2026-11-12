import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the nullish-coalescing default branches in the GET /api/runs/:id/skills
// handler that tests/api/runsSkills.test.ts does not exercise: a
// SKILL_INJECTION event with no skillIds array, and a SKILL_DISTILLATION
// event missing shouldPersist/reason.

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
  return { app, mockAgentSkillRepo };
}

describe("GET /api/runs/:id/skills — default-value branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing no skills", async () => {
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

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to empty string when the distillation payload omits them", async () => {
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

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
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
