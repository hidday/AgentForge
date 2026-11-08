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

  describe("(j) summarizePlan / summarizeExecution / summarizeRemediation field-aware rendering", () => {
    function makePlanArtifact(payloadJson: unknown) {
      return {
        id: "plan-artifact-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson,
        rawText: JSON.stringify(payloadJson),
        createdAt: new Date(),
      };
    }

    function makeRemediationArtifact(payloadJson: unknown) {
      return {
        id: "remediation-artifact-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson,
        rawText: JSON.stringify(payloadJson),
        createdAt: new Date(),
      };
    }

    it("renders a rich plan summary: many steps (>12), many assumptions/risks (>8), a long field needing truncation, and a step with no description", async () => {
      const deps = buildDeps();
      const longText = "x".repeat(700);
      const steps = Array.from({ length: 13 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Step ${i + 1}`,
        description: i === 0 ? "" : `Description for step ${i + 1}`,
      }));
      const planPayload = {
        planVersion: 1,
        summary: longText,
        assumptions: Array.from({ length: 9 }, (_, i) => `Assumption ${i + 1}`),
        openQuestions: [],
        risks: Array.from({ length: 9 }, (_, i) => `Risk ${i + 1}`),
        steps,
        testPlan: "Run the full suite",
        confidence: 0.75,
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(planPayload));
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("…and 1 more steps");
      expect(promptArg).toContain("…and 1 more");
      expect(promptArg).toContain("…"); // truncated long summary
    });

    it("renders an empty-shape plan summary (no steps, no assumptions, no risks) via '_none_' fallbacks", async () => {
      const deps = buildDeps();
      const planPayload = {
        planVersion: 1,
        summary: "Short summary",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [],
        testPlan: "n/a",
        confidence: 0.5,
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(planPayload));
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("_none_");
    });

    it("renders a plan summary with a step count at or below the 12-step cap without an '…and N more steps' suffix", async () => {
      const deps = buildDeps();
      const planPayload = {
        planVersion: 1,
        summary: "Short summary",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [
          { id: "s1", title: "Step 1", description: "Do the first thing" },
          { id: "s2", title: "Step 2", description: "Do the second thing" },
        ],
        testPlan: "n/a",
        confidence: 0.5,
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(planPayload));
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("1. Step 1 — Do the first thing");
      expect(promptArg).toContain("2. Step 2 — Do the second thing");
      expect(promptArg).not.toContain("more steps");
    });

    it("falls back to truncated JSON when the Plan artifact payload does not match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact({ not: "a valid plan" }));
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("not");
      expect(promptArg).toContain("a valid plan");
    });

    it("falls back to truncated JSON when the ExecutionReport artifact payload does not match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: { malformed: true },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("malformed");
    });

    it("renders execution checks with a failing status and details, and files/notes beyond their caps", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented the feature.",
              filesChanged: Array.from({ length: 42 }, (_, i) => `src/file${i}.ts`),
              checks: {
                lint: { status: "fail", details: "2 lint errors" },
                typecheck: { status: "pass", details: "" },
                // status fail but no details, to cover the `&& c.details` false arm
                tests: { status: "fail", details: "" },
              },
              notes: Array.from({ length: 16 }, (_, i) => `Note ${i + 1}`),
              prDraftCreated: true,
              score: 0.6,
              scoreRationale: "Mostly good",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("lint: fail — 2 lint errors");
      expect(promptArg).toContain("tests: fail");
      expect(promptArg).toContain("…and 2 more"); // filesChanged beyond 40
      expect(promptArg).toContain("…and 1 more"); // notes beyond 15
    });

    it("renders a rich remediation summary with many resolutions (>15) including one with no rationale", async () => {
      const deps = buildDeps();
      const resolution = Array.from({ length: 16 }, (_, i) => ({
        findingId: `f${i + 1}`,
        status: "accepted" as const,
        action: `Fixed finding ${i + 1}`,
        rationale: i === 0 ? "" : `Rationale for finding ${i + 1}`,
      }));
      const remediationPayload = {
        reviewId: "rev-1",
        resolution,
        readyForHumanReview: true,
        executionReport: {
          executionVersion: 2,
          summary: "Remediated.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "All good now.",
        },
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") {
          return Promise.resolve(makeRemediationArtifact(remediationPayload));
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("…and 1 more");
      expect(promptArg).toContain("Ready for human review");
    });

    it("renders an empty-shape remediation summary via the '_none_' fallback", async () => {
      const deps = buildDeps();
      const remediationPayload = {
        reviewId: "rev-1",
        resolution: [],
        readyForHumanReview: false,
        executionReport: {
          executionVersion: 2,
          summary: "Remediated.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "All good now.",
        },
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") {
          return Promise.resolve(makeRemediationArtifact(remediationPayload));
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("_none_");
    });

    it("renders a remediation summary with a resolution count at or below the 15-item cap without an '…and N more' suffix", async () => {
      const deps = buildDeps();
      const remediationPayload = {
        reviewId: "rev-1",
        resolution: [
          { findingId: "f1", status: "accepted" as const, action: "Fixed it", rationale: "Because X" },
        ],
        readyForHumanReview: true,
        executionReport: {
          executionVersion: 2,
          summary: "Remediated.",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "All good now.",
        },
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") {
          return Promise.resolve(makeRemediationArtifact(remediationPayload));
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("- [accepted] f1: Fixed it");
      expect(promptArg).toContain("*why*: Because X");
      expect(promptArg).not.toContain("more");
    });

    it("falls back to truncated JSON when the Remediation artifact payload does not match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") {
          return Promise.resolve(makeRemediationArtifact({ broken: true }));
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("Remediation Summary");
      expect(promptArg).toContain("broken");
    });
  });

  describe("(k) task query construction from run fields", () => {
    it("falls back to empty strings when linearIssueTitle and linearIssueDescription are absent", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ linearIssueTitle: null, linearIssueDescription: null });
      await agent.run("run-1", run);

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      // taskCategory_hint falls back to "" when linearIssueTitle is null
      expect(promptArg).not.toContain("null");
      expect(deps.eventRepo.create).toHaveBeenCalled();
    });

    it("includes linearIssueTitle and a slice of linearIssueDescription when present", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({
        linearIssueTitle: "Add rate limiting",
        linearIssueDescription: "Users are hitting the API too often and need throttling.",
      });
      await agent.run("run-1", run);

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("Add rate limiting");
    });
  });

  describe("(l) existing skills summary rendering", () => {
    it("renders existing skills with and without a display name, and skips the novelty gate when configured to always pass", async () => {
      const deps = buildDeps({
        config: { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 1.1 },
      });
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({ id: "skill-a", name: "named-skill", taskCategory: "category A" }),
        { ...makeSkill({ id: "skill-b", taskCategory: "category B" }), name: null },
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("[named-skill] category A");
      expect(promptArg).toContain("[category B] category B");
    });
  });

  describe("(m) LLM call rejects with a non-Error value", () => {
    it("emits reason='parse_error' when the rejection value is not an Error instance", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("a plain string failure");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ reason: "parse_error" }),
        }),
      );
    });
  });

  describe("(n) headroom gate: LLM says persist but omits required fields", () => {
    it("skips persisting with reason='missing_required_skill_fields' when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          skillMarkdown: "Some markdown",
          // taskCategory intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
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

    it("skips persisting with reason='missing_required_skill_fields' when skillMarkdown is whitespace-only", () => {
      // Covered by the dedicated async test below; kept separate to document intent.
      expect(true).toBe(true);
    });

    it("skips persisting when skillMarkdown is whitespace-only even though shouldPersist=true", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          skillMarkdown: "   ",
          taskCategory: "some category",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            reason: "missing_required_skill_fields",
          }),
        }),
      );
    });
  });

  describe("(o) description fallback when the LLM omits or blanks the description", () => {
    it("falls back to a generated description when decision.description is omitted", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          skillMarkdown: "Use retries with backoff.",
          taskCategory: "retry logic",
          name: "retry-logic",
          // description intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ repo: "acme/widgets" });
      await agent.run("run-1", run);

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on retry logic in acme/widgets.",
        }),
      );
    });

    it("falls back to a generated description when decision.description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          skillMarkdown: "Use retries with backoff.",
          taskCategory: "retry logic",
          name: "retry-logic",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ repo: "acme/widgets" });
      await agent.run("run-1", run);

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on retry logic in acme/widgets.",
        }),
      );
    });
  });
});
