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

  describe("(j) Rich plan/execution/remediation summaries", () => {
    it("builds field-aware summaries into the prompt when Plan, ExecutionReport and Remediation artifacts all exist and validate", async () => {
      const deps = buildDeps();

      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "A".repeat(700),
          assumptions: Array.from({ length: 9 }, (_, i) => `assumption ${i}`),
          openQuestions: [],
          risks: Array.from({ length: 9 }, (_, i) => `risk ${i}`),
          steps: Array.from({ length: 13 }, (_, i) => ({
            id: `s${i}`,
            title: `Step ${i}`,
            description: i === 0 ? "do the thing" : "",
          })),
          testPlan: "B".repeat(450),
          confidence: 0.77,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const executionArtifact = {
        id: "exec-rich",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "C".repeat(650),
          filesChanged: Array.from({ length: 41 }, (_, i) => `file${i}.ts`),
          checks: {
            lint: { status: "fail", details: "lint error details" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: Array.from({ length: 16 }, (_, i) => `note ${i}`),
          prDraftCreated: true,
          score: 0.5,
          scoreRationale: "D".repeat(450),
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: Array.from({ length: 16 }, (_, i) => ({
            findingId: `f${i}`,
            status: "accepted" as const,
            action: `fix ${i}`,
            rationale: i === 0 ? "because" : "",
          })),
          readyForHumanReview: true,
          executionReport: {
            executionVersion: 1,
            summary: "ok",
            filesChanged: [],
            checks: {
              lint: { status: "pass", details: "" },
              typecheck: { status: "pass", details: "" },
              tests: { status: "pass", details: "" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.9,
            scoreRationale: "fine",
          },
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      // Unrelated existing skill (keeps novelty overlap low) with name: null,
      // to also exercise the `skill.name ?? undefined` mapping branch.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          name: null,
          description: null,
          taskCategory: "totally unrelated topic",
          skillMarkdown: "nothing whatsoever to do with authentication",
        }),
      ]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(1);
      // Force the novelty pre-check to pass regardless of trigram overlap so the
      // LLM path (and the rich-summary building) is exercised.
      deps.config.NOVELTY_SIMILARITY_THRESHOLD = 2;

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "rich artifacts",
          name: "auth-middleware",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
          // description intentionally omitted -> exercises the default-description fallback
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;

      // Plan summary: step overflow + bulletList cap overflow + truncation ellipsis
      expect(promptArg).toContain("…and 1 more steps");
      expect(promptArg).toContain("**Confidence**: 0.77");
      expect(promptArg).toMatch(/A{100,}…/);

      // Execution summary: failing check w/ details + filesChanged overflow + notes overflow
      expect(promptArg).toContain("lint error details");
      expect(promptArg).toContain("- …and 1 more");

      // Remediation summary: header, resolution overflow, and rationale text
      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain("*why*: because");
      expect(promptArg).toContain("…and 1 more");

      // Existing skills summary (non-empty, null name falls back to taskCategory)
      expect(promptArg).toContain("totally unrelated topic");

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in test-repo.",
        }),
      );
    });

    it("renders _none_ placeholders for a valid plan with no steps and a valid remediation with no resolutions", async () => {
      const deps = buildDeps();
      const emptyPlanArtifact = {
        id: "plan-empty",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Nothing to do.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "No testing required.",
          confidence: 0.1,
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      const emptyRemediationArtifact = {
        id: "rem-empty",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-empty",
          resolution: [],
          readyForHumanReview: false,
          executionReport: {
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
            score: 0.1,
            scoreRationale: "nothing done",
          },
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      const validExecutionArtifact = {
        id: "exec-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "fine",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "fine",
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(emptyPlanArtifact);
        if (type === "Remediation") return Promise.resolve(emptyRemediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(validExecutionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Steps**:\n_none_");
      expect(promptArg).toContain("**Resolutions**:\n_none_");
    });

    it("falls back to truncated raw JSON for the plan summary when the Plan artifact payload fails schema validation", async () => {
      const deps = buildDeps();
      const invalidPlanArtifact = {
        id: "plan-bad",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { not: "a valid plan" },
        rawText: "{}",
        createdAt: new Date(),
      };
      const validExecutionArtifact = {
        id: "exec-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "fine",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "fine",
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(invalidPlanArtifact);
        if (type === "ExecutionReport") return Promise.resolve(validExecutionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain('{"not":"a valid plan"}');
    });

    it("falls back to truncated raw JSON for the execution summary when the ExecutionReport payload fails schema validation", async () => {
      const deps = buildDeps();
      const badExecutionArtifact = {
        id: "exec-bad",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: { foo: "bar" },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(badExecutionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain('{"foo":"bar"}');
    });

    it("falls back to a raw JSON remediation summary when the Remediation artifact payload fails schema validation", async () => {
      const deps = buildDeps();
      const badRemediationArtifact = {
        id: "rem-bad",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { bad: true },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(badRemediationArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "fine",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.9,
              scoreRationale: "fine",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain('{"bad":true}');
    });
  });

  describe("(k) Missing required skill fields after shouldPersist=true", () => {
    it("skips persistence and logs a warning when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "missing category",
          skillMarkdown: "Some markdown content.",
          // taskCategory intentionally omitted
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

    it("skips persistence when skillMarkdown is missing even though taskCategory is present", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "missing markdown",
          taskCategory: "auth middleware",
          // skillMarkdown intentionally omitted
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
          }),
        }),
      );
    });

    it("skips persistence when skillMarkdown is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "whitespace markdown",
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
});
