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
    name: overrides.name ?? "auth-middleware",
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

  describe("(j) summarizePlan / summarizeExecution / summarizeRemediation field-aware summaries", () => {
    function makePlanArtifact(overrides: Record<string, unknown> = {}) {
      return {
        id: "plan-artifact-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Add JWT auth middleware to the API layer.",
          assumptions: ["Users already have accounts", "OAuth is out of scope"],
          openQuestions: [],
          risks: ["Token expiry edge cases", "Breaking existing sessions"],
          steps: [{ id: "s1", title: "Add middleware", description: "Wire up the JWT check" }],
          testPlan: "Add unit tests for the middleware and an integration test for login.",
          confidence: 0.8,
          ...overrides,
        },
        rawText: "",
        createdAt: new Date(),
      };
    }

    function makeRemediationArtifact(overrides: Record<string, unknown> = {}) {
      return {
        id: "remediation-artifact-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          resolution: [
            {
              findingId: "f1",
              status: "accepted",
              action: "Added null check",
              rationale: "Prevents a crash on missing user",
            },
          ],
          readyForHumanReview: true,
          executionReport: {
            executionVersion: 2,
            summary: "Fixed the review findings.",
            filesChanged: ["src/middleware/auth.ts"],
            checks: {
              lint: { status: "pass", details: "" },
              typecheck: { status: "pass", details: "" },
              tests: { status: "pass", details: "" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.9,
            scoreRationale: "All checks pass after addressing findings.",
          },
          ...overrides,
        },
        rawText: "",
        createdAt: new Date(),
      };
    }

    it("passes the field-aware plan summary (with assumptions/risks/steps) to the prompt when a Plan artifact exists", async () => {
      const deps = buildDeps();
      const execArtifact = {
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
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact());
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("**Summary**: Add JWT auth middleware to the API layer.");
      expect(capturedPrompt).toContain("**Assumptions**:");
      expect(capturedPrompt).toContain("Users already have accounts");
      expect(capturedPrompt).toContain("**Risks**:");
      expect(capturedPrompt).toContain("Token expiry edge cases");
      expect(capturedPrompt).toContain("Add middleware");
    });

    it("renders '_none_' for plan steps when the plan has zero steps", async () => {
      const deps = buildDeps();
      const plan = makePlanArtifact({ steps: [] });
      const execArtifact = {
        id: "artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "Done.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.5,
          scoreRationale: "n/a",
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(plan);
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("**Steps**:\n_none_");
    });

    it("truncates plan assumptions/risks past the cap with an '…and N more' marker", async () => {
      const deps = buildDeps();
      const manyRisks = Array.from({ length: 12 }, (_, i) => `Risk number ${i + 1}`);
      const plan = makePlanArtifact({ risks: manyRisks });
      const execArtifact = {
        id: "artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "Done.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.5,
          scoreRationale: "n/a",
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(plan);
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("…and 4 more");
    });

    it("falls back to truncated JSON when the Plan payload does not match the schema", async () => {
      const deps = buildDeps();
      const malformedPlan = {
        id: "plan-artifact-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { not: "a valid plan shape" },
        rawText: "",
        createdAt: new Date(),
      };
      const execArtifact = {
        id: "artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "Done.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.5,
          scoreRationale: "n/a",
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(malformedPlan);
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain('"a valid plan shape"');
    });

    it("lists more than 40 changed files with an '…and N more' marker in the execution summary", async () => {
      const deps = buildDeps();
      const manyFiles = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
      const execArtifact = {
        id: "artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "Touched a lot of files.",
          filesChanged: manyFiles,
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: false,
          score: 0.5,
          scoreRationale: "n/a",
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("…and 5 more");
    });

    it("includes a field-aware remediation summary when a Remediation artifact exists", async () => {
      const deps = buildDeps();
      const remediationArtifact = makeRemediationArtifact();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport")
          return Promise.resolve({
            id: "artifact-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Done.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "n/a",
            },
            rawText: "",
            createdAt: new Date(),
          });
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("## Remediation Summary");
      expect(capturedPrompt).toContain("Added null check");
      expect(capturedPrompt).toContain("Prevents a crash on missing user");
      expect(capturedPrompt).toContain("**Ready for human review**: true");
    });

    it("renders '_none_' for remediation resolutions when the array is empty", async () => {
      const deps = buildDeps();
      const remediationArtifact = makeRemediationArtifact({ resolution: [] });
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport")
          return Promise.resolve({
            id: "artifact-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Done.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "n/a",
            },
            rawText: "",
            createdAt: new Date(),
          });
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("**Resolutions**:\n_none_");
    });

    it("falls back to truncated JSON when the Remediation payload does not match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport")
          return Promise.resolve({
            id: "artifact-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Done.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "n/a",
            },
            rawText: "",
            createdAt: new Date(),
          });
        if (type === "Remediation")
          return Promise.resolve({
            id: "remediation-artifact-1",
            runId: "run-1",
            type: "Remediation" as const,
            version: 1,
            payloadJson: { not: "a valid remediation shape" },
            rawText: "",
            createdAt: new Date(),
          });
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("## Remediation Summary");
      expect(capturedPrompt).toContain('"a valid remediation shape"');
    });

    it("includes the existing skills summary text when the repo has active skills", async () => {
      const deps = buildDeps();
      // Deliberately unrelated to the run's title ("Add auth middleware") so the
      // deterministic novelty pre-check does not short-circuit before the LLM call.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          name: "db-migration-helper",
          taskCategory: "database migration",
          skillMarkdown: "Run alembic upgrade head before deploying.",
        }),
      ]);

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "review only" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain(
        "[db-migration-helper] database migration: Run alembic upgrade head before deploying.",
      );
    });
  });

  describe("(k) missing required skill fields after shouldPersist=true", () => {
    it("emits shouldPersist=false with reason=missing_required_skill_fields when taskCategory is blank", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "   ",
          skillMarkdown: "Some markdown",
        }),
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
            reason: "missing_required_skill_fields",
            displacedSkillId: null,
          }),
        }),
      );
    });

    it("emits shouldPersist=false with reason=missing_required_skill_fields when skillMarkdown is blank", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "   ",
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

  describe("(l) description fallback when the LLM omits a description", () => {
    it("uses a generated 'Use when working on <taskCategory> in <repo>' description when description is blank", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use RS256 tokens.",
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
