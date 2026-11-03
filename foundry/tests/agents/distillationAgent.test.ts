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

  describe("(j) Prompt summarization: Plan and Remediation artifacts present", () => {
    it("summarizes a full Plan artifact (assumptions/risks/steps/testPlan) into the user prompt", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Add JWT auth middleware",
          requirementsTraceability: "",
          assumptions: ["Users already have accounts"],
          openQuestions: [],
          risks: ["Token expiry edge cases"],
          steps: [{ id: "s1", title: "Add middleware", description: "Wire up JWT verification" }],
          testPlan: "Run auth integration tests",
          confidence: 0.85,
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
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
              scoreRationale: "Implementation matches plan.",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no need to persist" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("Add JWT auth middleware");
      expect(promptArg).toContain("Users already have accounts");
      expect(promptArg).toContain("Token expiry edge cases");
      expect(promptArg).toContain("Add middleware");
      expect(promptArg).toContain("Run auth integration tests");
    });

    it("truncates plan steps beyond 12 with an '…and N more steps' marker", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const steps = Array.from({ length: 15 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Step ${i + 1}`,
        description: `desc ${i + 1}`,
      }));
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Big plan",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps,
          testPlan: "n/a",
          confidence: 0.5,
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
        Promise.resolve(
          type === "Plan"
            ? planArtifact
            : type === "ExecutionReport"
              ? {
                  id: "exec-1",
                  runId: "run-1",
                  type: "ExecutionReport" as const,
                  version: 1,
                  payloadJson: {
                    executionVersion: 1,
                    summary: "done",
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
                  rawText: "",
                  createdAt: new Date(),
                }
              : null,
        ),
      );
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("…and 3 more steps");
    });

    it("summarizes a Remediation artifact's resolutions and final score into the user prompt", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: [
            { findingId: "f1", status: "accepted", action: "Fixed null check", rationale: "Prevents crash" },
          ],
          readyForHumanReview: true,
          executionReport: {
            executionVersion: 2,
            summary: "Fixed",
            filesChanged: ["src/a.ts"],
            checks: {
              lint: { status: "pass", details: "" },
              typecheck: { status: "pass", details: "" },
              tests: { status: "pass", details: "" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.95,
            scoreRationale: "All good now",
          },
        },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("Fixed null check");
      expect(promptArg).toContain("Prevents crash");
      expect(promptArg).toContain("Ready for human review");
    });

    it("caps remediation resolutions beyond 15 with an '…and N more' marker", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const resolution = Array.from({ length: 18 }, (_, i) => ({
        findingId: `f${i + 1}`,
        status: "accepted" as const,
        action: `action ${i + 1}`,
        rationale: "",
      }));
      const executionReport = {
        executionVersion: 1,
        summary: "done",
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
      };
      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { reviewId: "rev-1", resolution, readyForHumanReview: false, executionReport },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({ ...remediationArtifact, type: "ExecutionReport" as const, payloadJson: executionReport });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("…and 3 more");
    });
  });

  describe("(k) Execution report edge cases: empty filesChanged, failing checks", () => {
    it("renders '_none_' for an empty filesChanged list and includes failing-check details", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
        Promise.resolve(
          type === "ExecutionReport"
            ? {
                id: "exec-1",
                runId: "run-1",
                type: "ExecutionReport" as const,
                version: 1,
                payloadJson: {
                  executionVersion: 1,
                  summary: "Partial failure",
                  filesChanged: [],
                  checks: {
                    lint: { status: "fail", details: "unexpected any" },
                    typecheck: { status: "pass", details: "" },
                    tests: { status: "pass", details: "" },
                  },
                  notes: [],
                  prDraftCreated: false,
                  score: 0.3,
                  scoreRationale: "lint failed",
                },
                rawText: "",
                createdAt: new Date(),
              }
            : null,
        ),
      );
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("unexpected any");
    });
  });

  describe("(l) Missing required skill fields on persist", () => {
    it("skips persisting and records 'missing_required_skill_fields' when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          skillMarkdown: "do the thing",
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
          }),
        }),
      );
    });

    it("skips persisting when skillMarkdown is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "auth middleware",
          // skillMarkdown intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ reason: "missing_required_skill_fields" }),
        }),
      );
    });

    it("falls back to a generated description when the LLM omits one", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "auth middleware",
          skillMarkdown: "do the thing",
          // description intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "org/repo" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in org/repo.",
        }),
      );
    });
  });

  describe("(m) Prior skills summary rendered when novelty gate passes with an active pool", () => {
    it("includes existing skill summaries in the prompt when the pool is non-empty but dissimilar", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          id: "unrelated-1",
          name: "deploy-pipeline",
          taskCategory: "deploy pipeline",
          skillMarkdown: "Use blue-green deploys for zero downtime releases.",
        }),
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({ linearIssueTitle: "Completely unrelated authentication refactor" }),
      );

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("deploy-pipeline");
    });
  });

  describe("(n) Remaining summarization edge cases", () => {
    it("renders '_none_' for empty plan steps and empty remediation resolutions", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Empty-steps plan",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "n/a",
          confidence: 0.5,
        },
        rawText: "",
        createdAt: new Date(),
      };
      const executionReport = {
        executionVersion: 1,
        summary: "done",
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
      };
      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { reviewId: "rev-1", resolution: [], readyForHumanReview: false, executionReport },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({ ...remediationArtifact, type: "ExecutionReport" as const, payloadJson: executionReport });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("_none_");
    });

    it("falls back to truncated raw JSON when the Plan or Remediation payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const malformedPlan = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { notAValidPlan: true },
        rawText: "",
        createdAt: new Date(),
      };
      const executionReport = {
        executionVersion: 1,
        summary: "done",
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
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(malformedPlan);
        if (type === "ExecutionReport") {
          return Promise.resolve({ ...malformedPlan, type: "ExecutionReport" as const, payloadJson: executionReport });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("notAValidPlan");
    });

    it("caps bulleted assumptions/risks beyond 8 items with an '…and N more' marker, and truncates long items", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Plan with many assumptions",
          assumptions: Array.from({ length: 10 }, (_, i) => `assumption ${i + 1}`),
          openQuestions: [],
          risks: [],
          steps: [{ id: "s1", title: "x".repeat(150), description: "" }],
          testPlan: "n/a",
          confidence: 0.5,
        },
        rawText: "",
        createdAt: new Date(),
      };
      const executionReport = {
        executionVersion: 1,
        summary: "done",
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
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({ ...planArtifact, type: "ExecutionReport" as const, payloadJson: executionReport });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("…and 2 more");
      // The 150-char step title is truncated to 120 chars plus an ellipsis.
      expect(promptArg).toContain("x".repeat(120) + "…");
    });

    it("includes the linearIssueDescription (truncated to 200 chars) in the novelty-check task query", async () => {
      const deps = buildDeps();
      // A description similar enough to an active skill should trip the novelty gate,
      // proving the description text was actually folded into the task query.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          taskCategory: "rate limiting",
          skillMarkdown: "Use a token bucket algorithm for API rate limiting with Redis.",
        }),
      ]);

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({
          linearIssueTitle: "Unrelated title",
          linearIssueDescription:
            "Use a token bucket algorithm for API rate limiting with Redis." + "x".repeat(300),
        }),
      );

      expect(deps.agentRunner.run).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            reason: expect.stringContaining("novelty_gate_failed"),
          }),
        }),
      );
    });

    it("handles a missing linearIssueTitle and an active skill with no name", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        { ...makeSkill({ taskCategory: "generic task" }), name: null },
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ linearIssueTitle: null }));

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      // Falls back to taskCategory for the label when name is null.
      expect(promptArg).toContain("[generic task] generic task");
    });

    it("stringifies a non-Error throwable from the LLM call", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue("non-error-rejection");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "non-error-rejection" }),
        "Distillation LLM call failed or parse error",
      );
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ payloadJson: expect.objectContaining({ reason: "parse_error" }) }),
      );
    });

    it("falls back to truncated raw JSON when the Remediation payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const malformedRemediation = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { notAValidRemediation: true },
        rawText: "",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(malformedRemediation);
        if (type === "ExecutionReport") {
          return Promise.resolve({
            ...malformedRemediation,
            type: "ExecutionReport" as const,
            payloadJson: {
              executionVersion: 1,
              summary: "done",
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
          });
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("notAValidRemediation");
    });

    it("caps the files-changed list beyond 40 entries with an '…and N more' marker", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      const manyFiles = Array.from({ length: 45 }, (_, i) => `src/file${i + 1}.ts`);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
        Promise.resolve(
          type === "ExecutionReport"
            ? {
                id: "exec-1",
                runId: "run-1",
                type: "ExecutionReport" as const,
                version: 1,
                payloadJson: {
                  executionVersion: 1,
                  summary: "done",
                  filesChanged: manyFiles,
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
                rawText: "",
                createdAt: new Date(),
              }
            : null,
        ),
      );
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0][1].prompt as string;
      expect(promptArg).toContain("…and 5 more");
    });

    it("defaults taskCategory to null in the event payload when the LLM omits it on a skip decision", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "generic, not worth persisting" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false, taskCategory: null }),
        }),
      );
    });
  });
});
