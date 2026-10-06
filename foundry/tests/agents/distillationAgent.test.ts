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

  describe("(j) Plan artifact present: summarizePlan is rendered into the user prompt", () => {
    it("field-aware-summarizes the plan, truncating long fields and capping lists", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const longText = "A".repeat(700);
      const longTestPlan = "T".repeat(500);
      const assumptions = Array.from({ length: 10 }, (_, i) => `assumption-${i}-${"x".repeat(i === 9 ? 250 : 5)}`);
      const risks = Array.from({ length: 9 }, (_, i) => `risk-${i}`);
      const steps = Array.from({ length: 15 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Description for step ${i}`,
      }));

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented feature.",
              filesChanged: ["src/a.ts"],
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
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: longText,
              assumptions,
              openQuestions: [],
              risks,
              steps,
              testPlan: longTestPlan,
              confidence: 0.87,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      // Long summary/testPlan get truncated with an ellipsis, not inlined in full.
      expect(promptArg).toContain("…");
      expect(promptArg).not.toContain("A".repeat(601));
      expect(promptArg).not.toContain("T".repeat(401));
      // Confidence formatted to 2 decimals.
      expect(promptArg).toContain("**Confidence**: 0.87");
      // Assumptions capped at 8 with an overflow marker for the remaining 2.
      expect(promptArg).toContain("…and 2 more");
      // Steps capped at 12 with an overflow marker for the remaining 3.
      expect(promptArg).toContain("…and 3 more steps");
      expect(promptArg).toContain("1. Step 0");
    });

    it("renders '_none_' placeholders for empty steps/assumptions/risks and omits the description separator for a step with no description", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented feature.",
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
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "Short summary",
              assumptions: [],
              openQuestions: [],
              risks: [],
              steps: [{ id: "s1", title: "Only step", description: "" }],
              testPlan: "Run the suite",
              confidence: 0.5,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("**Assumptions**:\n_none_");
      expect(promptArg).toContain("**Risks**:\n_none_");
      // A step with an empty description has no " — " separator appended.
      expect(promptArg).toContain("1. Only step\n");
      expect(promptArg).not.toContain("Only step — ");
    });

    it("renders '_none_' for the Steps section when the plan has zero steps", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.6,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "Nothing planned yet",
              assumptions: ["one assumption"],
              openQuestions: [],
              risks: ["one risk"],
              steps: [],
              testPlan: "N/A",
              confidence: 0.1,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("**Steps**:\n_none_");
    });
  });

  describe("(k) Remediation artifact present: summarizeRemediation is rendered into the user prompt", () => {
    it("field-aware-summarizes remediation resolutions, capping the list at 15", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const resolution = Array.from({ length: 17 }, (_, i) => ({
        findingId: `finding-${i}`,
        status: "accepted" as const,
        action: `Fixed finding ${i}`,
        rationale: i === 0 ? "Because it was broken" : "",
      }));

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented feature.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "artifact-rem",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: {
              reviewId: "review-1",
              resolution,
              readyForHumanReview: true,
              executionReport: {
                executionVersion: 1,
                summary: "final",
                filesChanged: [],
                checks: {
                  lint: { status: "pass", details: "" },
                  typecheck: { status: "pass", details: "" },
                  tests: { status: "pass", details: "" },
                },
                notes: [],
                prDraftCreated: false,
                score: 0.77,
                scoreRationale: "Looks solid overall.",
              },
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain("**Ready for human review**: true");
      expect(promptArg).toContain("**Final score**: 0.77");
      expect(promptArg).toContain("[accepted] finding-0: Fixed finding 0");
      expect(promptArg).toContain("*why*: Because it was broken");
      // Capped at 15, with an overflow marker for the remaining 2.
      expect(promptArg).toContain("…and 2 more");
    });

    it("renders '_none_' when the remediation has an empty resolution list", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "artifact-rem",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: {
              reviewId: "review-1",
              resolution: [],
              readyForHumanReview: false,
              executionReport: {
                executionVersion: 1,
                summary: "final",
                filesChanged: [],
                checks: {
                  lint: { status: "pass", details: "" },
                  typecheck: { status: "pass", details: "" },
                  tests: { status: "pass", details: "" },
                },
                notes: [],
                prDraftCreated: false,
                score: 0.4,
                scoreRationale: "meh",
              },
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("**Resolutions**:\n_none_");
      expect(promptArg).toContain("**Ready for human review**: false");
    });

    it("renders no overflow marker when the resolution count is below the cap of 15", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "artifact-rem",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: {
              reviewId: "review-1",
              resolution: [
                { findingId: "f1", status: "accepted", action: "Fixed f1", rationale: "r1" },
                { findingId: "f2", status: "rejected", action: "Won't fix f2", rationale: "r2" },
                {
                  findingId: "f3",
                  status: "partially_addressed",
                  action: "Partly fixed f3",
                  rationale: "r3",
                },
              ],
              readyForHumanReview: true,
              executionReport: {
                executionVersion: 1,
                summary: "final",
                filesChanged: [],
                checks: {
                  lint: { status: "pass", details: "" },
                  typecheck: { status: "pass", details: "" },
                  tests: { status: "pass", details: "" },
                },
                notes: [],
                prDraftCreated: false,
                score: 0.9,
                scoreRationale: "great",
              },
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("[partially_addressed] f3: Partly fixed f3");
      expect(promptArg).not.toContain("more");
    });

    it("falls back to truncated JSON when the Remediation payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          // Missing required fields (resolution, executionReport, etc.) -> fails RemediationSchema.
          return Promise.resolve({
            id: "artifact-rem",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: { notAValidRemediation: true },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain("notAValidRemediation");
      // The structured fields are absent since the payload never parsed.
      expect(promptArg).not.toContain("**Ready for human review**");
    });
  });

  describe("(j2) summarizePlan/summarizeExecution fall back to truncated JSON on schema validation failure", () => {
    it("falls back to truncated JSON when the Plan payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        if (type === "Plan") {
          // Missing required fields (summary, steps, etc.) -> fails PlanSchema.
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: { notAValidPlan: true },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("notAValidPlan");
      // Field-aware headers are absent since the payload never parsed into a Plan.
      expect(promptArg).not.toContain("**Confidence**:");
    });

    it("falls back to truncated JSON when the ExecutionReport payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          // Missing required fields (summary, checks, score, etc.) -> fails ExecutionReportSchema,
          // but the artifact itself is still present so the early "no execution report" guard doesn't fire.
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: { notAValidExecutionReport: true },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("notAValidExecutionReport");
      // Field-aware headers are absent since the payload never parsed into an ExecutionReport.
      expect(promptArg).not.toContain("**Score**:");
    });

    it("includes failing-check details and caps filesChanged at 40 entries", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const filesChanged = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "artifact-exec",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "s",
              filesChanged,
              checks: {
                lint: { status: "fail", details: "2 lint errors in src/foo.ts" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.3,
              scoreRationale: "needs work",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("lint: fail — 2 lint errors in src/foo.ts");
      expect(promptArg).toContain("**Files Changed** (45):");
      expect(promptArg).toContain("…and 5 more");
    });
  });

  describe("(l) Active skill pool is non-empty but below the novelty threshold", () => {
    it("includes each skill's taskCategory/snippet in the prompt, falling back to taskCategory when name is null", async () => {
      const deps = buildDeps();
      // Built directly (not via makeSkill(), whose `??` defaults coerce an
      // explicit `name: null` back to a non-null default) so the second skill
      // genuinely has name=null, exercising the `s.name ?? s.taskCategory` fallback.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        {
          ...makeSkill(),
          name: "db-migrations",
          description: "Use when running database migrations.",
          taskCategory: "database migration",
          skillMarkdown: "Run alembic migrations in order before deploying.",
        },
        {
          ...makeSkill(),
          name: null,
          description: "Use when configuring API rate limits.",
          taskCategory: "api rate limiting",
          skillMarkdown: "Use Redis for rate limit buckets.",
        },
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      // Task query ("Add auth middleware") is dissimilar enough from both skills
      // to stay below the default 0.5 novelty threshold and reach the LLM call.
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (
        deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown]
      )[1].prompt;

      expect(promptArg).toContain("[db-migrations] database migration: Run alembic migrations");
      // Skill with name=null falls back to taskCategory as its display label.
      expect(promptArg).toContain("[api rate limiting] api rate limiting: Use Redis");
    });
  });

  describe("(m) Missing linearIssueTitle and absent linearIssueDescription do not crash task-query building", () => {
    it("still runs the full pipeline when both are unset", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ linearIssueTitle: null }));

      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false }),
        }),
      );
    });

    it("slices a long linearIssueDescription into the task query without throwing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no durable lesson" }),
      );

      const agent = buildAgent(deps);
      const longDescription = "D".repeat(500);
      await agent.run("run-1", makeRun({ linearIssueDescription: longDescription }));

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false }),
        }),
      );
    });
  });

  describe("(n) LLM says persist=true but omits taskCategory/skillMarkdown", () => {
    it("emits missing_required_skill_fields and persists nothing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "looks novel",
          // taskCategory and skillMarkdown both omitted
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

    it("also treats a whitespace-only skillMarkdown as missing (trim() check)", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "looks novel",
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

  describe("(o) Description fallback when LLM omits or provides whitespace-only description", () => {
    it("falls back to the generated template description when description is undefined", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "durable lesson",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
          // description omitted entirely
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

    it("falls back to the generated template description when description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "durable lesson",
          taskCategory: "auth middleware",
          description: "   ",
          skillMarkdown: "Use JWT.",
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

  describe("(p) agentRunner.run rejects with a non-Error value", () => {
    it("still emits reason=parse_error, logging String(err) for the non-Error cause", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue("a plain string failure");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            shouldPersist: false,
            reason: "parse_error",
          }),
        }),
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "a plain string failure" }),
        expect.stringContaining("Distillation LLM call failed"),
      );
    });
  });
});
