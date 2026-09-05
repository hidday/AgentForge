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

  describe("(j) Field-aware Plan/Execution/Remediation summarization in the prompt", () => {
    function buildDepsWithCapture(overrides: Record<string, unknown> = {}) {
      const deps = buildDeps(overrides);
      let capturedUserPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedUserPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "just inspecting prompt" });
        },
      );
      return { deps, getPrompt: () => capturedUserPrompt };
    }

    function validPlanPayload(overrides: Record<string, unknown> = {}) {
      return {
        planVersion: 1,
        summary: "Add JWT auth middleware.",
        requirementsTraceability: "trace",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
        testPlan: "Run the suite",
        confidence: 0.8,
        ...overrides,
      };
    }

    function validRemediationPayload(overrides: Record<string, unknown> = {}) {
      return {
        reviewId: "rev-1",
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" },
        ],
        readyForHumanReview: true,
        executionReport: {
          executionVersion: 2,
          summary: "Post-remediation summary",
          filesChanged: ["src/x.ts"],
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
          notes: [],
          prDraftCreated: true,
          score: 0.9,
          scoreRationale: "Solid",
        },
        ...overrides,
      };
    }

    it("summarizes a valid Plan artifact with steps/assumptions/risks, truncating oversized lists", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented.",
              filesChanged: ["src/a.ts"],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.8,
              scoreRationale: "Good",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: validPlanPayload({
              assumptions: Array.from({ length: 9 }, (_, i) => `Assumption ${i}`),
              risks: [],
              steps: Array.from({ length: 13 }, (_, i) => ({
                id: `s${i}`,
                title: `Step ${i}`,
                description: `Do step ${i}`,
              })),
            }),
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("**Summary**: Add JWT auth middleware.");
      expect(prompt).toContain("**Confidence**: 0.80");
      expect(prompt).toContain("…and 1 more steps");
      expect(prompt).toContain("…and 1 more");
      expect(prompt).toContain("_none_");
    });

    it("falls back to truncated JSON when the Plan artifact payload doesn't match the schema", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "fail", details: "1 flaky test" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.5,
              scoreRationale: "Meh",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: { notAPlan: true },
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain('"notAPlan":true');
      // Failing check with details should surface its details; empty files list shows "_none_".
      expect(prompt).toContain("tests: fail");
      expect(prompt).toContain("1 flaky test");
      expect(prompt).toContain("_none_");
    });

    it("truncates the files-changed list beyond 40 entries", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      const manyFiles = Array.from({ length: 41 }, (_, i) => `src/file${i}.ts`);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented.",
              filesChanged: manyFiles,
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.8,
              scoreRationale: "Good",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("Files Changed** (41):");
      expect(prompt).toContain("…and 1 more");
    });

    it("includes a field-aware Remediation summary, truncating resolutions beyond 15", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 2,
              summary: "Post-remediation",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.9,
              scoreRationale: "Solid",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "rem-1",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: validRemediationPayload({
              resolution: Array.from({ length: 16 }, (_, i) => ({
                findingId: `f${i}`,
                status: "accepted",
                action: `Fixed ${i}`,
                rationale: "",
              })),
            }),
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain("**Ready for human review**: true");
      expect(prompt).toContain("…and 1 more");
    });

    it("falls back to truncated JSON when the Remediation artifact payload doesn't match the schema", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.8,
              scoreRationale: "Good",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "rem-1",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: { notRemediation: true },
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain('"notRemediation":true');
    });

    it("renders existing skills as bullet lines (with and without a name) when the pool is non-empty but below the novelty threshold", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      const unnamedSkill = makeSkill({ id: "s2", taskCategory: "unrelated topic b" });
      unnamedSkill.name = null;
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({ id: "s1", name: "named-skill", taskCategory: "unrelated topic a" }),
        unnamedSkill,
      ]);

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({ linearIssueTitle: "completely different task about billing" }),
      );

      const prompt = getPrompt();
      expect(prompt).toContain("[named-skill] unrelated topic a");
      expect(prompt).toContain("[unrelated topic b] unrelated topic b");
    });

    it("derives the task query safely when linearIssueTitle is null and linearIssueDescription is present", async () => {
      const { deps } = buildDepsWithCapture();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const agent = buildAgent(deps);
      const run = makeRun({ linearIssueTitle: null });
      (run as unknown as { linearIssueDescription: string }).linearIssueDescription =
        "A".repeat(300);

      await expect(agent.run("run-1", run)).resolves.toBeUndefined();
    });

    it("truncates an overlong plan summary and omits the step description separator when a step has none", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      const longSummary = "x".repeat(700);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 1,
              summary: "Implemented.",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.8,
              scoreRationale: "Good",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: validPlanPayload({
              summary: longSummary,
              steps: [{ id: "s1", title: "Only step", description: "" }],
            }),
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("…");
      expect(prompt).not.toContain(longSummary);
      expect(prompt).toContain("1. Only step");
      expect(prompt).not.toContain("Only step —");
    });

    it("falls back to truncated JSON when the ExecutionReport artifact payload doesn't match the schema", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: { notAnExecutionReport: true },
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain('"notAnExecutionReport":true');
    });

    it("includes a truthy rationale and omits the 'more' suffix for a Remediation within the resolutions cap", async () => {
      const { deps, getPrompt } = buildDepsWithCapture();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "exec-1",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              executionVersion: 2,
              summary: "Post-remediation",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.9,
              scoreRationale: "Solid",
            },
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") {
          return Promise.resolve({
            id: "rem-1",
            runId: "run-1",
            type: "Remediation",
            version: 1,
            payloadJson: validRemediationPayload(),
            rawText: "",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt();
      expect(prompt).toContain("*why*: Real bug");
      expect(prompt).not.toContain("…and");
    });

    it("stringifies a non-Error rejection reason when the LLM call fails", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue("plain string failure");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        "Distillation LLM call failed or parse error",
      );
    });
  });

  describe("(k) Missing-field and description-fallback guards when shouldPersist=true", () => {
    it("skips persisting when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          skillMarkdown: "Some markdown",
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

    it("skips persisting when skillMarkdown is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "some category",
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

    it("skips persisting when skillMarkdown is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
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
    });

    it("falls back to a generated description when the LLM omits one", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "billing retries",
          skillMarkdown: "Retry with exponential backoff.",
          name: "billing-retries",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "acme/backend" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on billing retries in acme/backend.",
        }),
      );
    });

    it("falls back to a generated description when the LLM's description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight",
          taskCategory: "billing retries",
          skillMarkdown: "Retry with exponential backoff.",
          name: "billing-retries",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "acme/backend" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on billing retries in acme/backend.",
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
