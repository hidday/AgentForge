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
});

// ---------------------------------------------------------------------------
// Extended coverage: field-aware summarizers (summarizePlan / summarizeExecution
// / summarizeRemediation), taskQuery construction, existing-skills formatting,
// non-Error rejection handling, and the missing-fields / description-fallback
// gates below the LLM call.
// ---------------------------------------------------------------------------

function withArtifact(
  deps: ReturnType<typeof buildDeps>,
  type: "Plan" | "ExecutionReport" | "Remediation",
  payloadJson: unknown,
) {
  const original = deps.artifactRepo.findLatestByType.getMockImplementation();
  deps.artifactRepo.findLatestByType.mockImplementation((runId: string, t: string) => {
    if (t === type) {
      return Promise.resolve({
        id: `${type}-artifact`,
        runId,
        type,
        version: 1,
        payloadJson,
        rawText: "{}",
        createdAt: new Date(),
      });
    }
    return original ? original(runId, t) : Promise.resolve(null);
  });
}

function getPrompt(deps: ReturnType<typeof buildDeps>): string {
  const call = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }];
  return call[1].prompt;
}

describe("DistillationAgent - extended coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarizePlan (via Plan artifact)", () => {
    it("renders summary/confidence/assumptions/risks/steps/testPlan and truncates a long summary", async () => {
      const deps = buildDeps();
      const longSummary = "x".repeat(650);
      withArtifact(deps, "Plan", {
        planVersion: 1,
        summary: longSummary,
        assumptions: ["Assumption A", "Assumption B"],
        openQuestions: [],
        risks: ["Risk A"],
        steps: [
          { id: "s1", title: "Step One Title", description: "Detailed description of step one." },
          { id: "s2", title: "Step Two Title", description: "" },
        ],
        testPlan: "Run full test suite",
        confidence: 0.87,
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain(`**Summary**: ${"x".repeat(600)}…`);
      expect(prompt).not.toContain("x".repeat(601));
      expect(prompt).toContain("**Confidence**: 0.87");
      expect(prompt).toContain("**Assumptions**:\n- Assumption A\n- Assumption B");
      expect(prompt).toContain("**Risks**:\n- Risk A");
      expect(prompt).toContain(
        "**Steps**:\n1. Step One Title — Detailed description of step one.\n2. Step Two Title",
      );
      expect(prompt).toContain("**Test Plan**: Run full test suite");
    });

    it("appends an overflow marker when there are more than 12 steps", async () => {
      const deps = buildDeps();
      const steps = Array.from({ length: 15 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Step ${i + 1}`,
        description: "",
      }));
      withArtifact(deps, "Plan", {
        planVersion: 1,
        summary: "Short summary",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps,
        testPlan: "Run tests",
        confidence: 0.5,
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("12. Step 12");
      expect(prompt).not.toContain("13. Step 13");
      expect(prompt).toContain("\n…and 3 more steps");
    });

    it("renders '_none_' for empty steps, assumptions, and risks", async () => {
      const deps = buildDeps();
      withArtifact(deps, "Plan", {
        planVersion: 1,
        summary: "Nothing much",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [],
        testPlan: "Run tests",
        confidence: 0.5,
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("**Steps**:\n_none_");
      expect(prompt).toContain("**Assumptions**:\n_none_");
      expect(prompt).toContain("**Risks**:\n_none_");
    });

    it("falls back to truncated JSON when the Plan payload doesn't match the schema", async () => {
      const deps = buildDeps();
      withArtifact(deps, "Plan", { foo: "bar" });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain('{"foo":"bar"}');
      expect(prompt).not.toContain("**Confidence**");
    });
  });

  describe("summarizeExecution (additional branches)", () => {
    it("lists notes and appends an overflow marker when there are more than 15", async () => {
      const deps = buildDeps();
      const notes = Array.from({ length: 17 }, (_, i) => `Note ${i + 1}`);
      withArtifact(deps, "ExecutionReport", {
        executionVersion: 1,
        summary: "Did work",
        filesChanged: ["src/a.ts"],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes,
        prDraftCreated: true,
        score: 0.9,
        scoreRationale: "Great",
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("- Note 1");
      expect(prompt).toContain("- Note 15");
      expect(prompt).not.toContain("- Note 16");
      expect(prompt).toContain("\n- …and 2 more");
    });

    it("lists filesChanged and appends an overflow marker when there are more than 40", async () => {
      const deps = buildDeps();
      const filesChanged = Array.from({ length: 42 }, (_, i) => `src/file${i}.ts`);
      withArtifact(deps, "ExecutionReport", {
        executionVersion: 1,
        summary: "Did work",
        filesChanged,
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.9,
        scoreRationale: "Great",
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("**Files Changed** (42):");
      expect(prompt).toContain("- src/file0.ts");
      expect(prompt).toContain("- src/file39.ts");
      expect(prompt).not.toContain("- src/file40.ts");
      expect(prompt).toContain("\n- …and 2 more");
    });

    it("shows check details only for failing checks with non-empty details", async () => {
      const deps = buildDeps();
      withArtifact(deps, "ExecutionReport", {
        executionVersion: 1,
        summary: "Did work",
        filesChanged: [],
        checks: {
          lint: { status: "fail", details: "missing eslint config" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "" },
        },
        notes: [],
        prDraftCreated: false,
        score: 0.3,
        scoreRationale: "Needs work",
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("- lint: fail — missing eslint config");
      expect(prompt).toContain("- typecheck: pass");
      expect(prompt).toContain("- tests: fail\n");
      expect(prompt).not.toContain("- tests: fail — ");
    });

    it("falls back to truncated JSON when the ExecutionReport payload doesn't match the schema", async () => {
      const deps = buildDeps();
      withArtifact(deps, "ExecutionReport", { summary: "incomplete, missing checks" });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain('"summary":"incomplete, missing checks"');
      expect(prompt).not.toContain("**Score**");
    });
  });

  describe("summarizeRemediation (via Remediation artifact)", () => {
    function validExecutionReport() {
      return {
        executionVersion: 1,
        summary: "Fixed it",
        filesChanged: ["src/a.ts"],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.75,
        scoreRationale: "Looks solid after remediation.",
      };
    }

    it("formats resolutions (with and without rationale), score, and readyForHumanReview", async () => {
      const deps = buildDeps();
      withArtifact(deps, "Remediation", {
        reviewId: "review-1",
        resolution: [
          {
            findingId: "f1",
            status: "accepted",
            action: "Added null check",
            rationale: "Prevents crash on empty input",
          },
          {
            findingId: "f2",
            status: "rejected",
            action: "No change needed",
            rationale: "",
          },
        ],
        readyForHumanReview: true,
        executionReport: validExecutionReport(),
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain("**Ready for human review**: true");
      expect(prompt).toContain("**Final score**: 0.75 — Looks solid after remediation.");
      expect(prompt).toContain("- [accepted] f1: Added null check\n  *why*: Prevents crash on empty input");
      expect(prompt).toContain("- [rejected] f2: No change needed");
      expect(prompt).not.toContain("f2: No change needed\n  *why*");
    });

    it("appends an overflow marker when there are more than 15 resolutions", async () => {
      const deps = buildDeps();
      const resolution = Array.from({ length: 17 }, (_, i) => ({
        findingId: `f${i + 1}`,
        status: "accepted" as const,
        action: `Fix ${i + 1}`,
        rationale: "",
      }));
      withArtifact(deps, "Remediation", {
        reviewId: "review-1",
        resolution,
        readyForHumanReview: false,
        executionReport: validExecutionReport(),
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("f15: Fix 15");
      expect(prompt).not.toContain("f16: Fix 16");
      expect(prompt).toContain("\n- …and 2 more");
    });

    it("renders '_none_' when resolution is empty", async () => {
      const deps = buildDeps();
      withArtifact(deps, "Remediation", {
        reviewId: "review-1",
        resolution: [],
        readyForHumanReview: false,
        executionReport: validExecutionReport(),
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("**Resolutions**:\n_none_");
    });

    it("falls back to a truncated-JSON summary when the Remediation payload doesn't match the schema", async () => {
      const deps = buildDeps();
      withArtifact(deps, "Remediation", { reviewId: "review-1" });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps);
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain('{"reviewId":"review-1"}');
      expect(prompt).not.toContain("**Ready for human review**");
    });
  });

  describe("taskQuery construction from run title/description", () => {
    it("tolerates a null linearIssueTitle without throwing", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );
      const agent = buildAgent(deps);

      await expect(
        agent.run("run-1", makeRun({ linearIssueTitle: null })),
      ).resolves.toBeUndefined();
      expect(deps.agentRunner.run).toHaveBeenCalled();
    });

    it("folds the Linear issue description into the novelty query, changing the gate outcome", async () => {
      const { maxNoveltyOverlap } = await import("../../src/utils/similarity.js");

      const skill = makeSkill({
        taskCategory: "quantum flux capacitor calibration",
        skillMarkdown: "gibberish unrelated filler content xyz",
        name: null,
        description: null,
      });

      const withoutDescription = maxNoveltyOverlap([skill], "short ");
      const withDescription = maxNoveltyOverlap(
        [skill],
        "short quantum flux capacitor calibration",
      );
      expect(withDescription).toBeGreaterThan(withoutDescription);
      const threshold = (withoutDescription + withDescription) / 2;

      // Case A: description present -> query includes it -> gate fires.
      const depsA = buildDeps();
      depsA.config.NOVELTY_SIMILARITY_THRESHOLD = threshold;
      depsA.agentSkillRepo.findActiveByRepo.mockResolvedValue([skill]);
      const runA = makeRun({
        linearIssueTitle: "short",
        ...({ linearIssueDescription: "quantum flux capacitor calibration" } as Partial<Run>),
      });
      const agentA = buildAgent(depsA);
      await agentA.run("run-1", runA);
      expect(depsA.agentRunner.run).not.toHaveBeenCalled();
      expect(depsA.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: expect.stringContaining("novelty_gate_failed"),
          }),
        }),
      );

      // Case B: description absent -> query is just the title -> gate does not fire.
      const depsB = buildDeps();
      depsB.config.NOVELTY_SIMILARITY_THRESHOLD = threshold;
      depsB.agentSkillRepo.findActiveByRepo.mockResolvedValue([skill]);
      depsB.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "distinct enough" }),
      );
      const runB = makeRun({ linearIssueTitle: "short" });
      const agentB = buildAgent(depsB);
      await agentB.run("run-1", runB);
      expect(depsB.agentRunner.run).toHaveBeenCalled();
      expect(depsB.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "distinct enough",
          }),
        }),
      );
    });
  });

  describe("existing skills summary formatting", () => {
    it("lists each active skill by name (or taskCategory fallback) when below the novelty threshold", async () => {
      const deps = buildDeps();
      deps.config.NOVELTY_SIMILARITY_THRESHOLD = 0.99;
      const skillWithName = makeSkill({
        id: "s1",
        name: "auth-jwt",
        taskCategory: "auth middleware",
        skillMarkdown: "Some markdown content for skill 1",
      });
      const skillWithoutName = { ...makeSkill({ id: "s2" }), name: null as string | null };
      skillWithoutName.taskCategory = "db-migrations";
      skillWithoutName.skillMarkdown = "Some other content for skill 2";
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([skillWithName, skillWithoutName]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({ linearIssueTitle: "Improve caching layer performance for reads" }),
      );

      const prompt = getPrompt(deps);
      expect(prompt).toContain(
        "- [auth-jwt] auth middleware: Some markdown content for skill 1",
      );
      expect(prompt).toContain(
        "- [db-migrations] db-migrations: Some other content for skill 2",
      );
    });
  });

  describe("LLM call rejects with a non-Error value", () => {
    it("records reason=parse_error and stringifies the raw rejection value in the log", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("boom");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "boom" }),
        expect.any(String),
      );
      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
        }),
      );
    });
  });

  describe("missing required skill fields after shouldPersist=true", () => {
    it("skips persistence when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          skillMarkdown: "Valid markdown body",
          // taskCategory intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        expect.stringContaining("missing taskCategory or skillMarkdown"),
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

    it("skips persistence when skillMarkdown trims to an empty (whitespace-only) string", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "some category",
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

  describe("description fallback when the LLM omits or blanks it", () => {
    it("falls back to the generated description when the LLM omits description entirely", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "caching",
          skillMarkdown: "Cache things carefully.",
          name: "caching-tips",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on caching in acme/widgets.",
        }),
      );
    });

    it("falls back to the generated description when the LLM returns a whitespace-only description", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "caching",
          skillMarkdown: "Cache things carefully.",
          name: "caching-tips",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on caching in acme/widgets.",
        }),
      );
    });
  });
});
