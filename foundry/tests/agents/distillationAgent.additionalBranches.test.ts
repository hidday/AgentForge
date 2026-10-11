import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// This file covers branches/paths left uncovered by distillationAgent.test.ts:
// - summarizePlan (valid + schema-failure fallback), including bulletList's
//   non-empty / over-cap paths and the ">12 steps" overflow line.
// - summarizeExecution's filesChanged edge cases (0 files, >40 files) and
//   checkLine's failing-check-with-details / failing-check-without-details paths,
//   plus its own schema-failure fallback.
// - summarizeRemediation (valid, with >15 resolutions and an empty rationale).
// - existingSkillsSummary non-empty path (and the skill.name ?? undefined fallback).
// - run.linearIssueTitle / linearIssueDescription nullish-coalescing fallbacks.
// - the agentRunner.run rejection path with a non-Error throw value.
// - the "missing taskCategory/skillMarkdown" persistence guard.
// - the description nullish-fallback when the LLM omits/blanks it.

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

function validExecutionPayload(overrides: Record<string, unknown> = {}) {
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
    payloadJson: validExecutionPayload(),
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

function getPrompt(agentRunner: { run: ReturnType<typeof vi.fn> }): string {
  const call = agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
  return call[1].prompt;
}

describe("DistillationAgent additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarizePlan", () => {
    it("renders a field-aware summary (steps >12, assumptions/risks >8) when the Plan artifact is valid", async () => {
      const deps = buildDeps();
      const manySteps = Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Description for step ${i}`,
      }));
      const manyAssumptions = Array.from({ length: 10 }, (_, i) => `assumption ${i}`);
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "A detailed plan summary.",
          assumptions: manyAssumptions,
          openQuestions: [],
          risks: manyAssumptions,
          steps: manySteps,
          testPlan: "Run the full suite.",
          confidence: 0.73,
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("**Confidence**: 0.73");
      expect(prompt).toContain("…and 2 more steps");
      expect(prompt).toContain("…and 2 more"); // bulletList cap overflow (8-item cap, 10 items)
      expect(prompt).toContain("1. Step 0 — Description for step 0");
    });

    it("falls back to truncated JSON when the Plan artifact fails schema validation", async () => {
      const deps = buildDeps();
      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { not: "a valid plan" },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain('{"not":"a valid plan"}');
    });
  });

  describe("summarizeExecution edge cases", () => {
    it("falls back to truncated JSON when the ExecutionReport artifact fails schema validation", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = { garbage: true };
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain('{"garbage":true}');
    });

    it("shows '_none_' for filesChanged when the list is empty", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = validExecutionPayload({ filesChanged: [] });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("**Files Changed** (0):\n_none_");
    });

    it("appends an overflow note when more than 40 files changed", async () => {
      const deps = buildDeps();
      const files = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
      deps.executionArtifact.payloadJson = validExecutionPayload({ filesChanged: files });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("**Files Changed** (45):");
      expect(prompt).toContain("…and 5 more");
    });

    it("includes failure details for a failing check that has details", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = validExecutionPayload({
        checks: {
          lint: { status: "fail", details: "eslint found 3 errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("- lint: fail — eslint found 3 errors");
    });

    it("omits the trailing detail suffix for a failing check with empty details", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = validExecutionPayload({
        checks: {
          lint: { status: "fail", details: "" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("- lint: fail\n");
      expect(prompt).not.toContain("- lint: fail —");
    });
  });

  describe("summarizePlan edge cases", () => {
    it("truncates an overlong summary with an ellipsis", async () => {
      const deps = buildDeps();
      const longSummary = "A".repeat(650);
      const planArtifact = {
        id: "plan-2",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: longSummary,
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "Run the suite.",
          confidence: 0.5,
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain(`${"A".repeat(600)}…`);
      expect(prompt).toContain("**Steps**:\n_none_");
    });

    it("omits the em-dash suffix for a step with no description, and shows no overflow note for <=12 steps", async () => {
      const deps = buildDeps();
      const planArtifact = {
        id: "plan-3",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Short summary.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [
            { id: "s1", title: "Step without description", description: "" },
            { id: "s2", title: "Step two", description: "Has a description" },
          ],
          testPlan: "Run the suite.",
          confidence: 0.5,
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("1. Step without description\n2. Step two — Has a description");
      expect(prompt).not.toContain("more steps");
    });
  });

  describe("summarizeRemediation", () => {
    it("falls back to a truncated JSON summary when the Remediation artifact fails schema validation", async () => {
      const deps = buildDeps();
      const remediationArtifact = {
        id: "rem-invalid",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { not: "a valid remediation" },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain('## Remediation Summary\n{"not":"a valid remediation"}');
    });

    it("shows '_none_' for an empty resolution list and no overflow note for a small (<=15) list", async () => {
      const deps = buildDeps();
      const remediationArtifact = {
        id: "rem-empty",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-2",
          resolution: [],
          readyForHumanReview: false,
          executionReport: validExecutionPayload(),
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("**Ready for human review**: false");
      expect(prompt).toContain("**Resolutions**:\n_none_");
    });

    it("renders a small (<=15) resolution list with no overflow note", async () => {
      const deps = buildDeps();
      const remediationArtifact = {
        id: "rem-small",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-3",
          resolution: [
            { findingId: "f1", status: "rejected", action: "Did not change", rationale: "Not applicable" },
          ],
          readyForHumanReview: true,
          executionReport: validExecutionPayload(),
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("[rejected] f1: Did not change");
      expect(prompt).not.toContain("…and");
    });

    it("renders resolutions (>15 items, one with an empty rationale) when the Remediation artifact is valid", async () => {
      const deps = buildDeps();
      const resolutions = Array.from({ length: 17 }, (_, i) => ({
        findingId: `finding-${i}`,
        status: "accepted" as const,
        action: `Fixed issue ${i}`,
        rationale: i === 0 ? "" : `Because of reason ${i}`,
      }));
      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          resolution: resolutions,
          readyForHumanReview: true,
          executionReport: validExecutionPayload(),
        },
        rawText: "{}",
        createdAt: new Date(),
      };
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain("**Ready for human review**: true");
      expect(prompt).toContain("[accepted] finding-0: Fixed issue 0");
      expect(prompt).not.toContain("finding-0: Fixed issue 0\n  *why*");
      expect(prompt).toContain("*why*: Because of reason 1");
      expect(prompt).toContain("…and 2 more");
    });
  });

  describe("existingSkillsSummary non-empty path", () => {
    it("lists active skills in the prompt (falling back to taskCategory when name is null)", async () => {
      const deps = buildDeps();
      // Deliberately dissimilar to the task query so the novelty gate does not fire.
      const unrelatedSkill = makeSkill({
        id: "skill-unrelated",
        name: null,
        taskCategory: "unrelated category zzz",
        skillMarkdown: "Completely unrelated content about zzz topics qqq.",
      });
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([unrelatedSkill]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const prompt = getPrompt(deps.agentRunner);
      expect(prompt).toContain(
        "- [unrelated category zzz] unrelated category zzz: Completely unrelated content about zzz topics qqq.",
      );
    });
  });

  describe("run with nullish linearIssueTitle/linearIssueDescription", () => {
    it("builds the task query and taskCategory hint without throwing when linearIssueTitle is null", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ linearIssueTitle: null });
      await agent.run("run-1", run);

      const prompt = getPrompt(deps.agentRunner);
      // repoSlug still renders even though the title hint is empty.
      expect(prompt).toContain("test-repo");
    });

    it("uses linearIssueDescription (truncated to 200 chars) in the task query when present", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockImplementation(async () =>
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      const run = { ...makeRun(), linearIssueDescription: "x".repeat(250) } as unknown as Run;
      await agent.run("run-1", run);

      // No direct prompt assertion available for the internal taskQuery (it isn't
      // interpolated into the template), so assert indirectly: the call completed
      // without throwing and reached the LLM call, exercising the slice(0,200) path.
      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("agentRunner.run rejects with a non-Error value", () => {
    it("still emits a parse_error event, stringifying the thrown value", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("boom, not an Error instance");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "boom, not an Error instance" }),
        "Distillation LLM call failed or parse error",
      );
      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
        }),
      );
    });
  });

  describe("missing required skill fields on persist", () => {
    it("skips persistence and emits missing_required_skill_fields when skillMarkdown is absent", async () => {
      const deps = buildDeps();
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

    it("skips persistence when taskCategory is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "   ",
          skillMarkdown: "Some markdown.",
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
  });

  describe("description nullish-fallback", () => {
    it("falls back to the generated description when the LLM omits description", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256.",
          name: "auth-middleware",
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

    it("falls back to the generated description when the LLM sends a whitespace-only description", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256.",
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
});
