import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// This file covers gaps left by tests/agents/distillationAgent.test.ts:
// - summarizePlan / summarizeRemediation field-aware formatting (incl. truncation,
//   bulletList caps, schema-parse-fallback paths)
// - summarizeExecution edge branches (empty/overflowing filesChanged, failing checks)
// - taskQuery construction when linearIssueTitle/linearIssueDescription are absent/present
// - existingSkillsSummary non-empty path + skill.name nullish fallback
// - non-Error throw from agentRunner.run
// - missing taskCategory/skillMarkdown after shouldPersist=true
// - description fallback when LLM omits/blanks it

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
    name: overrides.name === undefined ? "auth-middleware" : overrides.name,
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

function baseExecutionPayload(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
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
    payloadJson: baseExecutionPayload(),
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
    executionArtifact,
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

describe("DistillationAgent gap coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarizePlan via a well-formed Plan artifact", () => {
    it("builds a field-aware plan summary and passes it in the prompt, exercising truncation/overflow", async () => {
      const deps = buildDeps();
      const longText = "x".repeat(900);
      const steps = Array.from({ length: 14 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Step ${i + 1} ${longText}`,
        description: i === 0 ? `Detail ${longText}` : "",
      }));
      const assumptions = Array.from({ length: 10 }, (_, i) => `assumption ${i} ${longText}`);
      const risks = Array.from({ length: 10 }, (_, i) => `risk ${i} ${longText}`);

      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: `Summary ${longText}`,
          assumptions,
          openQuestions: [],
          risks,
          steps,
          testPlan: `Test plan ${longText}`,
          confidence: 0.77,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") return Promise.resolve(planArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Confidence**: 0.77");
      expect(promptArg).toContain("…and 2 more steps");
      expect(promptArg).toContain("…and 2 more");
      // truncation marker from truncate()
      expect(promptArg).toContain("…");
    });

    it("renders '_none_' for the Steps section when steps is empty", async () => {
      const deps = buildDeps();
      const planArtifact = {
        id: "plan-empty-steps",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "A trivial plan with no steps yet.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "N/A",
          confidence: 0.4,
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") return Promise.resolve(planArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Steps**:\n_none_");
    });

    it("falls back to truncated JSON when the Plan payload fails schema validation", async () => {
      const deps = buildDeps();
      const badPlan = {
        id: "plan-bad",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { notAPlan: true },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") return Promise.resolve(badPlan);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain(JSON.stringify({ notAPlan: true }));
    });
  });

  describe("summarizeExecution edge branches", () => {
    it("renders '_none_' for empty filesChanged and includes failing-check details", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = baseExecutionPayload({
        filesChanged: [],
        checks: {
          lint: { status: "fail", details: "eslint found 3 errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Files Changed** (0):\n_none_");
      expect(promptArg).toContain("lint: fail — eslint found 3 errors");
    });

    it("overflows filesChanged past the 40-item cap", async () => {
      const deps = buildDeps();
      const files = Array.from({ length: 45 }, (_, i) => `src/file-${i}.ts`);
      deps.executionArtifact.payloadJson = baseExecutionPayload({ filesChanged: files });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("- …and 5 more");
    });

    it("falls back to truncated JSON when the ExecutionReport payload fails schema validation", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = { not: "an execution report" };
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain(JSON.stringify({ not: "an execution report" }));
    });
  });

  describe("summarizeRemediation via a well-formed Remediation artifact", () => {
    it("builds a field-aware remediation summary with resolution overflow and rationale", async () => {
      const deps = buildDeps();
      const resolution = Array.from({ length: 17 }, (_, i) => ({
        findingId: `F${i}`,
        status: "accepted" as const,
        action: `fix ${i}`,
        rationale: i === 0 ? "because reasons" : "",
      }));
      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution,
          readyForHumanReview: true,
          executionReport: baseExecutionPayload(),
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Ready for human review**: true");
      expect(promptArg).toContain("*why*: because reasons");
      expect(promptArg).toContain("…and 2 more");
    });

    it("renders '_none_' when resolution is empty", async () => {
      const deps = buildDeps();
      const remediationArtifact = {
        id: "rem-2",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-2",
          resolution: [],
          readyForHumanReview: false,
          executionReport: baseExecutionPayload(),
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("**Resolutions**:\n_none_");
    });

    it("falls back to truncated JSON when the Remediation payload fails schema validation", async () => {
      const deps = buildDeps();
      const badRemediation = {
        id: "rem-bad",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { not: "remediation" },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Remediation") return Promise.resolve(badRemediation);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("## Remediation Summary");
      expect(promptArg).toContain(JSON.stringify({ not: "remediation" }));
    });
  });

  describe("taskQuery construction", () => {
    it("falls back to an empty title and slices a present linearIssueDescription", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      const longDescription = "d".repeat(300);
      await agent.run(
        "run-1",
        makeRun({
          linearIssueTitle: null,
          ...({ linearIssueDescription: longDescription } as unknown as Partial<Run>),
        }),
      );

      // No throw, and the LLM call still happens (novelty gate passed with no active skills).
      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("existingSkillsSummary non-empty path with nullish skill.name", () => {
    it("includes active skills in the prompt using taskCategory fallback when name is null", async () => {
      const deps = buildDeps();
      // Low-overlap skill so the novelty pre-check does not short-circuit before the LLM call.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          id: "skill-unrelated",
          name: null,
          taskCategory: "unrelated category",
          skillMarkdown: "Totally different topic with no overlap whatsoever.",
        }),
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("[unrelated category] unrelated category:");
    });
  });

  describe("LLM call throws a non-Error value", () => {
    it("still emits SKILL_DISTILLATION with reason='parse_error'", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("a plain string rejection");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "a plain string rejection" }),
        "Distillation LLM call failed or parse error",
      );
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
        }),
      );
    });
  });

  describe("shouldPersist=true but required skill fields are missing", () => {
    it("skips persisting when taskCategory is blank and emits missing_required_skill_fields", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "   ",
          skillMarkdown: "Some markdown content",
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

    it("skips persisting when skillMarkdown is absent", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
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
  });

  describe("description fallback when LLM omits description", () => {
    it("falls back to the generated default description string", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "caching",
          skillMarkdown: "Cache DB connections.",
          name: "caching-skill",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun({ repo: "my-repo" }));

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on caching in my-repo.",
        }),
      );
    });
  });
});
