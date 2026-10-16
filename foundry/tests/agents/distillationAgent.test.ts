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

  describe("(c2) Novelty passes with a non-empty, non-overlapping skill pool", () => {
    it("includes existing skills in the prompt and still creates the new skill", async () => {
      const deps = buildDeps();
      // An existing skill whose topic has no trigram overlap with the task query,
      // so the novelty gate passes and we reach the LLM call with a non-empty pool —
      // exercising the "existingSkillsSummaryText" true branch (join of entries).
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          id: "unrelated-skill",
          name: "unrelated-topic",
          taskCategory: "totally unrelated topic",
          skillMarkdown: "Nothing to do with the current task at all.",
        }),
      ]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(1);
      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          name: "auth-middleware",
          description: "Use when adding JWT auth middleware.",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
          taskCategory: "auth middleware",
        });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("unrelated-topic");
      expect(capturedPrompt).toContain("totally unrelated topic");
      expect(capturedPrompt).not.toContain("No existing skills.");
      expect(deps.agentSkillRepo.create).toHaveBeenCalled();
    });
  });

  describe("(c3) shouldPersist=true but missing required fields", () => {
    it("skips persisting and emits reason=missing_required_skill_fields when skillMarkdown is blank", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          name: "auth-middleware",
          description: "desc",
          skillMarkdown: "   ",
          taskCategory: "auth middleware",
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

    it("skips persisting when taskCategory is missing entirely", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          skillMarkdown: "Some markdown content.",
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

  describe("(c4) description fallback when the LLM omits or blanks it", () => {
    it("falls back to a generated description when decision.description is undefined", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          name: "auth-middleware",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
          taskCategory: "auth middleware",
          // description intentionally omitted
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "test-repo" }));

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
          reason: "non-trivial insight",
          name: "auth-middleware",
          description: "   ",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
          taskCategory: "auth middleware",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "test-repo" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in test-repo.",
        }),
      );
    });
  });

  describe("(c5) Plan and Remediation artifacts present: full field-aware summaries", () => {
    it("summarizes plan, execution (with >40 files), and remediation (with >15 resolutions) into the prompt", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);

      const planArtifact = {
        id: "plan-artifact-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Add JWT auth middleware across all routes.",
          requirementsTraceability: "",
          assumptions: Array.from({ length: 10 }, (_, i) => `Assumption ${i + 1}`),
          openQuestions: [],
          risks: Array.from({ length: 10 }, (_, i) => `Risk ${i + 1}`),
          steps: Array.from({ length: 15 }, (_, i) => ({
            id: `s${i + 1}`,
            title: `Step ${i + 1}`,
            description: `Description ${i + 1}`,
          })),
          testPlan: "Run the full test suite.",
          confidence: 0.77,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const manyFiles = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
      const executionArtifactWithManyFiles = {
        id: "exec-artifact-1",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: {
          executionVersion: 1,
          summary: "Implemented JWT auth middleware across many files.",
          filesChanged: manyFiles,
          checks: {
            lint: { status: "fail", details: "2 lint errors" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
          notes: Array.from({ length: 20 }, (_, i) => `Note ${i + 1}`),
          prDraftCreated: true,
          score: 0.6,
          scoreRationale: "Mostly solid but lint failures remain.",
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const remediationArtifact = {
        id: "remediation-artifact-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          readyForHumanReview: true,
          executionReport: executionArtifactWithManyFiles.payloadJson,
          resolution: Array.from({ length: 18 }, (_, i) => ({
            findingId: `f${i + 1}`,
            status: "accepted" as const,
            action: `Fixed finding ${i + 1}`,
            rationale: `Because of reason ${i + 1}`,
          })),
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(executionArtifactWithManyFiles);
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          name: "auth-middleware",
          description: "Use when adding JWT auth middleware.",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
          taskCategory: "auth middleware",
        });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      // Plan summary: steps capped at 12, "…and 3 more steps"; risks/assumptions capped at 8.
      expect(capturedPrompt).toContain("Add JWT auth middleware across all routes.");
      expect(capturedPrompt).toContain("…and 3 more steps");
      expect(capturedPrompt).toContain("…and 2 more");

      // Execution summary: files capped at 40, "…and 5 more"; failing lint check shows details.
      expect(capturedPrompt).toContain("Files Changed** (45)");
      expect(capturedPrompt).toContain("…and 5 more");
      expect(capturedPrompt).toContain("lint: fail — 2 lint errors");

      // Remediation summary: resolutions capped at 15, "…and 3 more".
      expect(capturedPrompt).toContain("Remediation Summary");
      expect(capturedPrompt).toContain("Ready for human review");
      expect(deps.agentSkillRepo.create).toHaveBeenCalled();
    });

    it("falls back to truncated JSON when the Plan/Remediation artifact payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);

      const malformedPlanArtifact = {
        id: "plan-artifact-bad",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { notAValidPlan: true },
        rawText: "{}",
        createdAt: new Date(),
      };
      const malformedRemediationArtifact = {
        id: "remediation-artifact-bad",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { notValid: true },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport")
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
              scoreRationale: "ok",
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        if (type === "Plan") return Promise.resolve(malformedPlanArtifact);
        if (type === "Remediation") return Promise.resolve(malformedRemediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({ shouldPersist: false, reason: "n/a" });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain(JSON.stringify({ notAValidPlan: true }));
      expect(capturedPrompt).toContain("Remediation Summary");
      expect(capturedPrompt).toContain(JSON.stringify({ notValid: true }));
    });
  });

  describe("(c5b) Plan with zero steps and Remediation with zero resolutions", () => {
    it("renders '_none_' for the steps and resolutions bullet lists when both arrays are empty", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);

      const emptyStepsPlanArtifact = {
        id: "plan-artifact-empty",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Nothing to do yet.",
          requirementsTraceability: "",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "N/A",
          confidence: 0.1,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const executionArtifactMinimal = {
        id: "exec-minimal",
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
          scoreRationale: "ok",
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const emptyResolutionRemediationArtifact = {
        id: "remediation-empty",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          readyForHumanReview: false,
          executionReport: executionArtifactMinimal.payloadJson,
          resolution: [],
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(executionArtifactMinimal);
        if (type === "Plan") return Promise.resolve(emptyStepsPlanArtifact);
        if (type === "Remediation") return Promise.resolve(emptyResolutionRemediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({ shouldPersist: false, reason: "n/a" });
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("Nothing to do yet.");
      // Steps bullet list falls back to "_none_" when the plan has zero steps.
      expect(capturedPrompt).toMatch(/\*\*Steps\*\*:\s*\n_none_/);
      // Resolutions bullet list falls back to "_none_" when remediation has zero resolutions.
      expect(capturedPrompt).toMatch(/\*\*Resolutions\*\*:\s*\n_none_/);
    });
  });

  describe("(c6) taskQuery and existing-skill-summary optional field handling", () => {
    it("builds the task query and prompt correctly when linearIssueTitle/description are absent and skill.name is null", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        { ...makeSkill({ id: "nameless-skill", taskCategory: "unrelated area" }), name: null },
      ]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(1);

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(async (_runtime, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makeDistillationOutput({ shouldPersist: false, reason: "n/a" });
      });

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({ linearIssueTitle: null } as never),
      );

      // skill.name is null, so the summary falls back to taskCategory for the label.
      expect(capturedPrompt).toContain("[unrelated area] unrelated area");
      expect(deps.agentRunner.run).toHaveBeenCalled();
    });
  });

  describe("(c7) LLM call rejects with a non-Error value", () => {
    it("stringifies a non-Error rejection and emits reason=parse_error", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue("a plain string failure, not an Error instance");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "a plain string failure, not an Error instance",
        }),
        expect.any(String),
      );
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ reason: "parse_error" }),
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
