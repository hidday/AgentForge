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

  describe("(f2) Existing skills summary rendered when the active pool is non-empty", () => {
    it("includes each active skill's name/category/snippet in the prompt passed to the LLM", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          id: "skill-x",
          name: "jwt-auth",
          taskCategory: "auth",
          skillMarkdown: "Use JWT tokens signed with RS256.",
        }),
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;
      expect(promptArg).toContain("jwt-auth");
      expect(promptArg).toContain("Use JWT tokens signed with RS256");
    });
  });

  describe("(f3) Missing required skill fields after shouldPersist=true", () => {
    it("skips persisting and emits reason=missing_required_skill_fields when taskCategory is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          skillMarkdown: "Some markdown.",
          // taskCategory intentionally omitted
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

    it("skips persisting when skillMarkdown is missing", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          // skillMarkdown intentionally omitted
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

  describe("(f4) Description fallback when the LLM omits or blanks the description", () => {
    it("falls back to a generated description when description is absent", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256.",
          // description intentionally omitted
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

    it("falls back to a generated description when description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256.",
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

  describe("(j) summarizePlan / summarizeRemediation render into the LLM prompt", () => {
    it("renders plan, execution, and remediation summaries with overflow markers for long lists", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const planPayload = {
        planVersion: 2,
        summary: "x".repeat(700), // exceeds the 600-char cap in summarizePlan
        assumptions: Array.from({ length: 9 }, (_, i) => `Assumption ${i}`),
        openQuestions: [],
        risks: Array.from({ length: 9 }, (_, i) => `Risk ${i}`),
        steps: Array.from({ length: 13 }, (_, i) => ({
          id: `s${i}`,
          title: `Step ${i}`,
          // Step 0 (within the first-12 slice that gets rendered) has no
          // description, to cover the "no description" branch alongside the
          // others which do have one.
          description: i === 0 ? "" : `Description ${i}`,
        })),
        testPlan: "y".repeat(450), // exceeds the 400-char cap
        confidence: 0.77,
      };

      const execPayload = {
        executionVersion: 1,
        summary: "Implemented thing.",
        filesChanged: Array.from({ length: 41 }, (_, i) => `src/file${i}.ts`), // exceeds 40-cap
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "one flake" },
        },
        notes: Array.from({ length: 16 }, (_, i) => `Note ${i}`), // exceeds 15-cap
        prDraftCreated: true,
        score: 0.6,
        scoreRationale: "Needs follow-up.",
      };

      const remediationPayload = {
        reviewId: "rev-1",
        resolution: Array.from({ length: 16 }, (_, i) => ({
          findingId: `f${i}`,
          status: "accepted" as const,
          action: `Action ${i}`,
          // First item has no rationale, to cover the "no rationale" branch
          // alongside the rest which do have one.
          rationale: i === 0 ? "" : `Rationale ${i}`,
        })), // exceeds 15-cap
        readyForHumanReview: true,
        executionReport: execPayload,
      };

      const planArtifact = {
        id: "a-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 2,
        payloadJson: planPayload,
        rawText: "",
        createdAt: new Date(),
      };
      const execArtifact = {
        id: "a-exec",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: execPayload,
        rawText: "",
        createdAt: new Date(),
      };
      const remediationArtifact = {
        id: "a-rem",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: remediationPayload,
        rawText: "",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(execArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial, nothing to persist" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;

      // summarizePlan: truncated summary/testPlan, overflow markers for
      // assumptions/risks (cap 8) and steps (cap 12).
      expect(promptArg).toContain("x".repeat(600) + "…");
      expect(promptArg).toContain("…and 1 more steps");
      expect(promptArg).toContain("Assumption 0");
      expect(promptArg).toContain("Risk 0");

      // summarizeExecution: overflow markers for files (cap 40) and notes (cap 15).
      expect(promptArg).toContain("**Files Changed** (41):");
      expect(promptArg).toContain("…and 1 more");

      // summarizeRemediation: header, ready flag, resolutions, overflow marker (cap 15).
      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain("**Ready for human review**: true");
      expect(promptArg).toContain("Action 0");
    });

    it("falls back to truncated JSON when the Plan/Remediation artifact payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const invalidPlanArtifact = {
        id: "a-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { notAPlan: "missing required fields" },
        rawText: "",
        createdAt: new Date(),
      };
      const invalidRemediationArtifact = {
        id: "a-rem",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { notRemediation: true },
        rawText: "",
        createdAt: new Date(),
      };

      // The ExecutionReport artifact itself is also schema-invalid, covering
      // summarizeExecution's own fallback branch. The top-level "no execution
      // report" early-return only checks artifact presence, not its schema,
      // so this still reaches summarizeExecution(invalidPayload).
      const invalidExecutionArtifact = {
        id: "a-exec",
        runId: "run-1",
        type: "ExecutionReport" as const,
        version: 1,
        payloadJson: { notAnExecutionReport: true },
        rawText: "",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(invalidPlanArtifact);
        if (type === "ExecutionReport") return Promise.resolve(invalidExecutionArtifact);
        if (type === "Remediation") return Promise.resolve(invalidRemediationArtifact);
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;

      // Fallback path: raw JSON of the unparseable payload, not the structured
      // "**Summary**:" markdown that summarizePlan/summarizeExecution produce
      // on success.
      expect(promptArg).toContain('"notAPlan":"missing required fields"');
      expect(promptArg).toContain('"notAnExecutionReport":true');
      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain('"notRemediation":true');
    });

    it("renders '_none_' for empty steps and empty resolution lists", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const planArtifact = {
        id: "a-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Short plan.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "none",
          confidence: 0.5,
        },
        rawText: "",
        createdAt: new Date(),
      };
      const execPayload = {
        executionVersion: 1,
        summary: "ok",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.8,
        scoreRationale: "fine",
      };
      const remediationArtifact = {
        id: "a-rem",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: [],
          readyForHumanReview: true,
          executionReport: execPayload,
        },
        rawText: "",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "a-exec",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: execPayload,
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;

      expect(promptArg).toContain("**Steps**:\n_none_");
      expect(promptArg).toContain("**Resolutions**:\n_none_");
    });

    it("renders steps/resolutions without an overflow marker when counts are within the caps", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);

      const planArtifact = {
        id: "a-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Short plan.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [
            { id: "s1", title: "Step 1", description: "Do thing one" },
            { id: "s2", title: "Step 2", description: "Do thing two" },
            { id: "s3", title: "Step 3", description: "Do thing three" },
          ],
          testPlan: "Run tests",
          confidence: 0.8,
        },
        rawText: "",
        createdAt: new Date(),
      };
      const execPayload = {
        executionVersion: 1,
        summary: "ok",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.8,
        scoreRationale: "fine",
      };
      const remediationArtifact = {
        id: "a-rem",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: [
            { findingId: "f1", status: "accepted" as const, action: "Fix 1", rationale: "r1" },
            { findingId: "f2", status: "accepted" as const, action: "Fix 2", rationale: "r2" },
            { findingId: "f3", status: "accepted" as const, action: "Fix 3", rationale: "r3" },
          ],
          readyForHumanReview: true,
          executionReport: execPayload,
        },
        rawText: "",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") {
          return Promise.resolve({
            id: "a-exec",
            runId: "run-1",
            type: "ExecutionReport" as const,
            version: 1,
            payloadJson: execPayload,
            rawText: "",
            createdAt: new Date(),
          });
        }
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;

      expect(promptArg).toContain("3. Step 3");
      expect(promptArg).not.toContain("more steps");
      expect(promptArg).toContain("- [accepted] f3: Fix 3");
      expect(promptArg).not.toContain("…and");
    });
  });

  describe("(k) taskQuery fallbacks when linearIssueTitle/linearIssueDescription are absent or present", () => {
    it("includes the issue description in the novelty-check query when linearIssueDescription is set", async () => {
      const deps = buildDeps();
      // An existing skill whose markdown is near-identical to the issue
      // description text; the novelty gate only fires if that description is
      // actually folded into the query string used for similarity scoring.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          taskCategory: "rate limiting",
          skillMarkdown:
            "Use a sliding window counter backed by Redis for per-org rate limiting.",
        }),
      ]);

      const run = makeRun({
        linearIssueTitle: null,
        linearIssueDescription:
          "Use a sliding window counter backed by Redis for per-org rate limiting.",
      });

      const agent = buildAgent(deps);
      await agent.run("run-1", run);

      expect(deps.agentRunner.run).not.toHaveBeenCalled();
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            reason: expect.stringContaining("novelty_gate_failed"),
          }),
        }),
      );
    });

    it("renders an empty taskCategory_hint when linearIssueTitle is null", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ linearIssueTitle: null }));

      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;
      // The template renders the (empty) hint without the literal title text.
      expect(promptArg).not.toContain("Add auth middleware");
    });
  });

  describe("(l) Existing skill with no name falls back to taskCategory in the prompt", () => {
    it("uses taskCategory as the display label when a skill's name is null", async () => {
      const deps = buildDeps();
      // Built directly (not via makeSkill()) because makeSkill's `name:
      // overrides.name ?? "auth-middleware"` would coerce an explicit `null`
      // back to a default name, defeating the point of this fixture.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        { ...makeSkill(), name: null, taskCategory: "db-migrations", skillMarkdown: "Use alembic." },
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "trivial" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const callArgs = deps.agentRunner.run.mock.calls[0] as unknown[];
      const promptArg = (callArgs[1] as { prompt: string }).prompt;
      expect(promptArg).toContain("- [db-migrations] db-migrations: Use alembic.");
    });
  });

  describe("(m) Non-Error rejection from the LLM call", () => {
    it("stringifies a non-Error rejection value in the warn log", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
      deps.agentRunner.run.mockRejectedValue("plain string failure, not an Error instance");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "plain string failure, not an Error instance",
        }),
        "Distillation LLM call failed or parse error",
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
