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

function makeSkill(id: string) {
  return {
    id,
    repoSlug: "test-repo",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens with RS256 for stateless auth.",
    successCount: 3,
    failureCount: 1,
    utilityScore: 0.6,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    archivedAt: null,
  };
}

async function buildApp(overrides: {
  events?: unknown[];
  skills?: Record<string, unknown>;
} = {}) {
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

  const skillsMap = overrides.skills ?? {};
  const mockAgentSkillRepo = {
    findById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(skillsMap[id] ?? null)
    ),
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

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
  };

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
  return { app, mockOrchestrator, mockEventRepo, mockAgentSkillRepo };
}

describe("GET /api/runs/:id/skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("(j) Nominal case: SKILL_INJECTION and SKILL_DISTILLATION events present", () => {
    it("returns correct injectedSkills array and full distillationDecision", async () => {
      const skill1 = makeSkill("skill-id-1");
      const skill2 = makeSkill("skill-id-2");

      const events = [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-id-1", "skill-id-2"] },
          createdAt: new Date(),
        },
        {
          id: "event-2",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {
            shouldPersist: true,
            reason: "non-trivial architectural insight",
            taskCategory: "auth middleware",
            displacedSkillId: null,
          },
          createdAt: new Date(),
        },
      ];

      const { app } = await buildApp({
        events,
        skills: { "skill-id-1": skill1, "skill-id-2": skill2 },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        injectedSkills: unknown[];
        distillationDecision: {
          shouldPersist: boolean;
          reason: string;
          taskCategory: string | null;
          displacedSkillId: string | null;
        } | null;
      };

      expect(body.injectedSkills).toHaveLength(2);
      expect(body.injectedSkills[0]).toMatchObject({ id: "skill-id-1" });
      expect(body.injectedSkills[1]).toMatchObject({ id: "skill-id-2" });
      expect(body.distillationDecision).toMatchObject({
        shouldPersist: true,
        reason: "non-trivial architectural insight",
        taskCategory: "auth middleware",
        displacedSkillId: null,
      });
      expect(body.distilledSkill).toBeNull();
    });
  });

  describe("(n) Distilled skill: SKILL_DISTILLATION with skillId returns full skill", () => {
    it("returns distilledSkill when event payload includes skillId", async () => {
      const distilled = makeSkill("distilled-skill-1");
      distilled.taskCategory = "database optimization";
      distilled.skillMarkdown = "Always cache DB connections.";

      const events = [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {
            shouldPersist: true,
            reason: "architectural insight",
            taskCategory: "database optimization",
            skillId: "distilled-skill-1",
            displacedSkillId: null,
          },
          createdAt: new Date(),
        },
      ];

      const { app } = await buildApp({
        events,
        skills: { "distilled-skill-1": distilled },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        distilledSkill: { id: string; skillMarkdown: string } | null;
      };
      expect(body.distilledSkill).toMatchObject({
        id: "distilled-skill-1",
        skillMarkdown: "Always cache DB connections.",
      });
    });
  });

  describe("(o) Distilled skill fallback: lookup by repo + category near event time", () => {
    it("returns distilledSkill when skillId is absent but fallback finds a match", async () => {
      const distilled = makeSkill("legacy-skill-1");
      distilled.taskCategory = "auth middleware";
      distilled.skillMarkdown = "Legacy distilled skill.";

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

      const { app, mockAgentSkillRepo } = await buildApp({ events });
      mockAgentSkillRepo.findByRepoCategoryNearTime.mockResolvedValue(distilled);

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        distilledSkill: { id: string; skillMarkdown: string } | null;
      };
      expect(body.distilledSkill).toMatchObject({
        id: "legacy-skill-1",
        skillMarkdown: "Legacy distilled skill.",
      });
      expect(mockAgentSkillRepo.findByRepoCategoryNearTime).toHaveBeenCalledWith(
        "test-repo",
        "auth middleware",
        eventTime,
      );
    });
  });

  describe("(k) Empty case: no SKILL_INJECTION or SKILL_DISTILLATION events", () => {
    it("returns { injectedSkills: [], distillationDecision: null } with status 200", async () => {
      const { app } = await buildApp({ events: [] });

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { injectedSkills: unknown[]; distillationDecision: unknown };
      expect(body.injectedSkills).toEqual([]);
      expect(body.distillationDecision).toBeNull();
    });
  });

  describe("(l) Skip case: SKILL_DISTILLATION event with shouldPersist=false", () => {
    it("returns distillationDecision.shouldPersist=false, displacedSkillId=null", async () => {
      const events = [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {
            shouldPersist: false,
            reason: "novelty_gate_failed: max_overlap=0.750",
            taskCategory: null,
            displacedSkillId: null,
          },
          createdAt: new Date(),
        },
      ];

      const { app } = await buildApp({ events });

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        injectedSkills: unknown[];
        distillationDecision: {
          shouldPersist: boolean;
          displacedSkillId: string | null;
        } | null;
      };
      expect(body.injectedSkills).toEqual([]);
      expect(body.distillationDecision?.shouldPersist).toBe(false);
      expect(body.distillationDecision?.displacedSkillId).toBeNull();
    });
  });

  describe("(m) Displacement metadata: SKILL_DISTILLATION event has displacedSkillId", () => {
    it("endpoint response includes the displacedSkillId='xyz'", async () => {
      const events = [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {
            shouldPersist: true,
            reason: "architectural insight",
            taskCategory: "database optimization",
            displacedSkillId: "xyz",
          },
          createdAt: new Date(),
        },
      ];

      const { app } = await buildApp({ events });

      const response = await app.inject({
        method: "GET",
        url: "/api/runs/run-1/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        distillationDecision: {
          displacedSkillId: string | null;
        } | null;
      };
      expect(body.distillationDecision?.displacedSkillId).toBe("xyz");
    });
  });
});
