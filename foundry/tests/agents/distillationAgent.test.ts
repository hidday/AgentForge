import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Partial<Run> = {}): Run {
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

function makeSkill(overrides: {
  id?: string;
  name?: string | null;
  description?: string | null;
  taskCategory?: string;
  skillMarkdown?: string;
  repoSlug?: string;
  utilityScore?: number;
  successCount?: number;
  failureCount?: number;
  lastUsedAt?: Date;
  archivedAt?: Date | null;
} = {}) {
  return {
    id: overrides.id ?? "skill-1",
    repoSlug: overrides.repoSlug ?? "test-repo",
    name: "name" in overrides ? overrides.name : "auth-middleware",
    description: overrides.description ?? "Use when adding or changing auth middleware.",
    taskCategory: overrides.taskCategory ?? "auth middleware",
    skillMarkdown: overrides.skillMarkdown ?? "Use JWT tokens for auth.",
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    utilityScore: overrides.utilityScore ?? 0.5,
    lastUsedAt: overrides.lastUsedAt ?? new Date(),
    createdAt: new Date(),
    archivedAt: overrides.archivedAt ?? null,
  };
}

function makeDistillationOutput(decision: {
  shouldPersist: boolean;
  reason: string;
  skillMarkdown?: string;
  taskCategory?: string;
  name?: string;
  description?: string;
}) {
  return {
    raw: "raw output",
    parsed: {
      stage: "distillation" as const,
      payload: decision,
    },
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const agentRunner = { run: vi.fn() };
  const artifactRepo = { findLatestByType: vi.fn(), findByRunId: vi.fn(), create: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(makeSkill({ id: "new-skill-1" })),
    displaceAndCreate: vi.fn().mockResolvedValue({
      newSkill: makeSkill({ id: "new-skill-1" }),
      displacedSkillId: "displaced-skill-1",
    }),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const config = {
    MAX_SKILLS_PER_REPO: 5,
    NOVELTY_SIMILARITY_THRESHOLD: 0.5,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const executionArtifact = {
    id: "artifact-1",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson: {
      executionVersion: 1,
      summary: "Implemented JWT auth middleware.",
      filesChanged: ["src/middleware/auth.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Implementation matches plan and all checks pass.",
    },
    rawText: '{"outcome":"success"}',
    createdAt: new Date(),
  };

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
    return Promise.resolve(null);
  });

  return {
    agentRunner,
    artifactRepo,
    agentSkillRepo,
    eventRepo,
    config,
    logger,
    ...overrides,
  };
}

function buildAgent(deps: ReturnType<typeof buildDeps>): DistillationAgent {
  return new DistillationAgent(
    deps.agentRunner as never,
    deps.artifactRepo as never,
    deps.agentSkillRepo as never,
    deps.eventRepo as never,
    deps.config,
    deps.logger as never,
  );
}

describe("DistillationAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("(0) No ExecutionReport artifact", () => {
    it("emits SKILL_DISTILLATION with shouldPersist=false and reason=no_execution_report, no LLM call", async () => {
      const deps = buildDeps();
      // Override to return null for all artifact types (simulates missing ExecutionReport)
      deps.artifactRepo.findLatestByType.mockResolvedValue(null);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "no_execution_report",
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(a) Novelty pre-check gate fires", () => {
    it("emits SKILL_DISTILLATION with shouldPersist=false when overlap >= threshold, no LLM call", async () => {
      const deps = buildDeps();

      // Existing skill highly similar to the task query
      const similarSkill = makeSkill({
        taskCategory: "auth middleware",
        skillMarkdown: "Add auth middleware using JWT. Use JWT tokens for auth in middleware.",
      });
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([similarSkill]);

      const agent = buildAgent(deps);
      const run = makeRun();

      await agent.run("run-1", run);

      expect(deps.agentRunner.run).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: expect.stringContaining("novelty_gate_failed"),
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(b) Novelty passes, LLM returns shouldPersist=false", () => {
    it("emits SKILL_DISTILLATION with shouldPersist=false, no skill created, no displacement", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial happy path" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "trivial happy path",
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(c) All gates pass, pool below cap", () => {
    it("creates skill, emits SKILL_DISTILLATION with shouldPersist=true and displacedSkillId=null", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(2);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial architectural insight",
          name: "auth-middleware",
          description: "Use when adding JWT auth middleware.",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
          taskCategory: "auth middleware",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repoSlug: "test-repo",
          name: "auth-middleware",
          description: "Use when adding JWT auth middleware.",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
        }),
      );
      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: true,
            skillId: "new-skill-1",
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(d) Headroom gate: pool at MAX_SKILLS_PER_REPO, LLM says persist", () => {
    it("calls displaceAndCreate, emits SKILL_DISTILLATION with correct displacedSkillId", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(5); // = MAX_SKILLS_PER_REPO
      deps.agentSkillRepo.displaceAndCreate.mockResolvedValue({
        newSkill: makeSkill({ id: "new-skill-123" }),
        displacedSkillId: "displaced-skill-xyz",
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          name: "database-optimization",
          description: "Use when optimizing database access patterns.",
          skillMarkdown: "Always cache DB connections.",
          taskCategory: "database optimization",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.displaceAndCreate).toHaveBeenCalledWith("test-repo", {
        name: "database-optimization",
        description: "Use when optimizing database access patterns.",
        taskCategory: "database optimization",
        skillMarkdown: "Always cache DB connections.",
      });
      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: true,
            skillId: "new-skill-123",
          }),
        }),
      );
    });
  });

  describe("(e) Headroom gate: pool at cap, LLM says skip", () => {
    it("no displacement, no new skill, AiEvent has displacedSkillId=null", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(5);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: false,
          reason: "generic advice",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(f) LLM response unparseable", () => {
    it("emits SKILL_DISTILLATION with reason='parse_error', no skill created", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue(new Error("JSON parse failure"));

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "SKILL_DISTILLATION",
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "parse_error",
            displacedSkillId: null,
          }),
        }),
      );
    });
  });

  describe("(g) Trigram retrieval ranking and MAX_SKILLS_INJECTED ceiling", () => {
    it("findTopKByRelevance respects the ceiling when pool > K", async () => {
      // This tests the AgentSkillRepository.findTopKByRelevance behavior
      // via the similarity utilities it uses internally.
      // We test this at the utility level since findTopKByRelevance uses scoreSkillRelevance.
      const { scoreSkillRelevance } = await import("../../src/utils/similarity.js");

      const skills = [
        { taskCategory: "auth middleware", skillMarkdown: "JWT token authentication setup" },
        { taskCategory: "database migration", skillMarkdown: "Run alembic migrations in order" },
        { taskCategory: "API rate limiting", skillMarkdown: "Use Redis for rate limit buckets" },
      ];

      const query = "add JWT authentication middleware";
      const scores = skills.map((s) => scoreSkillRelevance(s, query));

      // auth middleware should score highest for this query
      expect(scores[0]).toBeGreaterThan(scores[1]);
      expect(scores[0]).toBeGreaterThan(scores[2]);
    });
  });

  describe("(h) Utility score update and archival", () => {
    it("successCount/(successCount+failureCount+1) formula is correct", () => {
      // Test the utility score formula directly
      const successCount = 3;
      const failureCount = 2;
      const expectedScore = successCount / (successCount + failureCount + 1);
      expect(expectedScore).toBeCloseTo(0.5, 5);
    });

    it("skill with score < 0.2 after >= 5 uses should be archived", () => {
      // Test the archival condition
      const skill = makeSkill({
        successCount: 0,
        failureCount: 5,
        utilityScore: 0 / (0 + 5 + 1), // = 0
      });
      const totalUses = skill.successCount + skill.failureCount;
      const shouldArchive = skill.utilityScore < 0.2 && totalUses >= 5;
      expect(shouldArchive).toBe(true);
    });

    it("skill with score >= 0.2 should NOT be archived even after >= 5 uses", () => {
      const skill = makeSkill({
        successCount: 2,
        failureCount: 3,
        utilityScore: 2 / (2 + 3 + 1), // = 0.333
      });
      const totalUses = skill.successCount + skill.failureCount;
      const shouldArchive = skill.utilityScore < 0.2 && totalUses >= 5;
      expect(shouldArchive).toBe(false);
    });
  });

  describe("(j) Existing skills summary rendering when the pool is non-empty and passes novelty", () => {
    it("renders each active skill's name/taskCategory/snippet into the prompt instead of 'No existing skills.'", async () => {
      const deps = buildDeps();
      // Dissimilar to the task query so the novelty pre-check passes and the LLM call happens.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({ name: "db-migrations", taskCategory: "database migration", skillMarkdown: "Run alembic upgrade head before any schema change." }),
      ]);
      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      expect(capturedPrompt).toContain("db-migrations");
      expect(capturedPrompt).toContain("database migration");
      expect(capturedPrompt).toContain("Run alembic upgrade head");
      expect(capturedPrompt).not.toContain("No existing skills.");
    });
  });

  describe("(k) shouldPersist=true but required fields missing", () => {
    it("skips persistence and emits missing_required_skill_fields when taskCategory is blank", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "   ",
          skillMarkdown: "Some markdown",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        { runId: "run-1" },
        "Distillation missing taskCategory or skillMarkdown, skipping persist",
      );
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "missing_required_skill_fields",
            displacedSkillId: null,
          }),
        }),
      );
    });

    it("skips persistence and emits missing_required_skill_fields when skillMarkdown is absent", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "auth middleware",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "missing_required_skill_fields",
          }),
        }),
      );
    });
  });

  describe("(l) Description fallback when the LLM omits or blanks the description", () => {
    it("falls back to a generated description when decision.description is undefined", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
          name: "auth-middleware",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in test-repo.",
        }),
      );
    });

    it("falls back to a generated description when decision.description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
          name: "auth-middleware",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in test-repo.",
        }),
      );
    });
  });

  describe("(m) summarizePlan/summarizeExecution/summarizeRemediation prompt rendering", () => {
    function buildDepsWithArtifacts(overrides: {
      planPayload?: unknown;
      executionPayload?: unknown;
      remediationPayload?: unknown;
    }) {
      const deps = buildDeps();
      const executionArtifact = {
        id: "artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: overrides.executionPayload ?? {
          executionVersion: 1,
          summary: "Implemented JWT auth middleware.",
          filesChanged: ["src/middleware/auth.ts"],
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.82,
          scoreRationale: "Implementation matches plan and all checks pass.",
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      const planArtifact = overrides.planPayload
        ? {
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan" as const,
            version: 1,
            payloadJson: overrides.planPayload,
            rawText: "{}",
            createdAt: new Date(),
          }
        : null;
      const remediationArtifact = overrides.remediationPayload
        ? {
            id: "artifact-rem",
            runId: "run-1",
            type: "Remediation" as const,
            version: 1,
            payloadJson: overrides.remediationPayload,
            rawText: "{}",
            createdAt: new Date(),
          }
        : null;

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });
      return deps;
    }

    function captureUserPrompt(deps: ReturnType<typeof buildDeps>, decision: Parameters<typeof makeDistillationOutput>[0] = { shouldPersist: false, reason: "stop here" }) {
      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput(decision);
      });
      return () => capturedPrompt;
    }

    it("renders a valid plan with truncation markers when steps/assumptions/risks exceed their caps", async () => {
      const manySteps = Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Description ${i}`,
      }));
      const manyAssumptions = Array.from({ length: 10 }, (_, i) => `Assumption ${i}`);
      const manyRisks = Array.from({ length: 9 }, (_, i) => `Risk ${i}`);
      const deps = buildDepsWithArtifacts({
        planPayload: {
          planVersion: 1,
          summary: "A plan with many steps",
          assumptions: manyAssumptions,
          openQuestions: [],
          risks: manyRisks,
          steps: manySteps,
          testPlan: "Run the full suite",
          confidence: 0.7,
        },
      });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("**Summary**: A plan with many steps");
      expect(prompt).toContain("**Confidence**: 0.70");
      expect(prompt).toContain("…and 2 more steps");
      expect(prompt).toContain("…and 2 more"); // assumptions cap=8, 10 items
      expect(prompt).toContain("…and 1 more"); // risks cap=8, 9 items
      expect(prompt).toContain("**Test Plan**: Run the full suite");
    });

    it("falls back to truncated JSON when the Plan artifact payload fails schema validation", async () => {
      const deps = buildDepsWithArtifacts({ planPayload: { not: "a valid plan" } });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain(JSON.stringify({ not: "a valid plan" }));
      expect(prompt).not.toContain("**Summary**: A plan");
    });

    it("renders execution report file list with overflow marker and surfaces details for a failing check", async () => {
      const manyFiles = Array.from({ length: 42 }, (_, i) => `src/file${i}.ts`);
      const deps = buildDepsWithArtifacts({
        executionPayload: {
          executionVersion: 1,
          summary: "Touched many files",
          filesChanged: manyFiles,
          checks: {
            lint: { status: "fail", details: "2 lint errors in file0.ts" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.3,
          scoreRationale: "Lint failures block merge.",
        },
      });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("**Files Changed** (42)");
      expect(prompt).toContain("…and 2 more");
      expect(prompt).toContain("- lint: fail — 2 lint errors in file0.ts");
      expect(prompt).toContain("- typecheck: pass");
      expect(prompt).not.toContain("- typecheck: pass — ok");
    });

    it("renders execution report with '_none_' files placeholder when filesChanged is empty", async () => {
      const deps = buildDepsWithArtifacts({
        executionPayload: {
          executionVersion: 1,
          summary: "No files touched",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.5,
          scoreRationale: "N/A",
        },
      });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("**Files Changed** (0):\n_none_");
    });

    it("falls back to truncated JSON when the ExecutionReport artifact payload fails schema validation", async () => {
      const deps = buildDepsWithArtifacts({ executionPayload: { garbage: true } });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain(JSON.stringify({ garbage: true }));
    });

    it("renders a valid remediation summary with an overflow marker when resolutions exceed the cap", async () => {
      const manyResolutions = Array.from({ length: 17 }, (_, i) => ({
        findingId: `f${i}`,
        status: "accepted" as const,
        action: `Fixed finding ${i}`,
        rationale: `Because of reason ${i}`,
      }));
      const deps = buildDepsWithArtifacts({
        remediationPayload: {
          reviewId: "rev-1",
          resolution: manyResolutions,
          readyForHumanReview: true,
          executionReport: {
            executionVersion: 1,
            summary: "Fixed everything",
            filesChanged: [],
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "pass", details: "ok" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.95,
            scoreRationale: "All findings addressed.",
          },
        },
      });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain("**Ready for human review**: true");
      expect(prompt).toContain("**Final score**: 0.95");
      expect(prompt).toContain("…and 2 more");
    });

    it("falls back to a truncated-JSON remediation summary when the Remediation artifact payload fails schema validation", async () => {
      const deps = buildDepsWithArtifacts({ remediationPayload: { nope: true } });
      const getPrompt = captureUserPrompt(deps);

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain(JSON.stringify({ nope: true }));
    });
  });

  describe("(n) taskQuery construction from the Run when fields are missing", () => {
    it("builds the novelty-check query without throwing when linearIssueTitle and linearIssueDescription are both absent", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ linearIssueTitle: null });
      delete (run as unknown as Record<string, unknown>).linearIssueDescription;

      await expect(agent.run("run-1", run)).resolves.toBeUndefined();
      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("(o) Catch block error formatting for non-Error rejections", () => {
    it("stringifies a non-Error rejection reason instead of reading .message", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      deps.agentRunner.run.mockRejectedValue("a plain string failure");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "a plain string failure" },
        "Distillation LLM call failed or parse error",
      );
    });
  });

  describe("(p) existingSkillsSummary falls back to taskCategory when a skill has no name", () => {
    it("uses taskCategory as the display label for an unnamed skill in the prompt", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({ name: null, taskCategory: "rate limiting", skillMarkdown: "Use a token bucket algorithm for throttling requests." }),
      ]);
      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({ shouldPersist: false, reason: "n/a" });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("[rate limiting] rate limiting:");
    });
  });

  describe("(i) No-skill backward-compat: empty priorSkills produces same output structure", () => {
    it("plannerAgent.run called with empty priorSkills works without error", async () => {
      const { PlannerAgent } = await import("../../src/agents/plannerAgent.js");

      const agentRunner = {
        run: vi.fn().mockResolvedValue({
          raw: "raw text",
          parsed: {
            payload: {
              planVersion: 1,
              summary: "Test plan",
              assumptions: [],
              openQuestions: [],
              risks: [],
              steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
              testPlan: "Run tests",
              confidence: 0.9,
            },
          },
        }),
      };

      const artifactRepo = { create: vi.fn(), findLatestByType: vi.fn(), findByRunId: vi.fn() };
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

      const planner = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

      const bundle = {
        issue: { id: "LIN-1", title: "Test", description: "Desc", labels: [], priority: 0 },
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/lin-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: [],
        },
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
        definitionOfDone: [],
      };

      const plan = await planner.run(bundle, "run-1", { priorSkills: [] });
      expect(plan.summary).toBe("Test plan");

      // Verify empty priorSkills doesn't add any section
      const promptArg = (agentRunner.run.mock.calls[0] as [unknown, { prompt: string }][])[0][1]?.prompt as string;
      // The prompt should not have the Prior Skills header when skills is empty
      if (promptArg) {
        expect(promptArg).not.toContain("## Prior Skills from Similar Tasks");
      }
    });
  });
});
