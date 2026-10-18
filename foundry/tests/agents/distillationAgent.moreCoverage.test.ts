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

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "auth-middleware",
    description: "Use when adding or changing auth middleware.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for auth.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
    ...overrides,
  };
}

function makeDistillationOutput(decision: Record<string, unknown>) {
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
    NOVELTY_SIMILARITY_THRESHOLD: 0.95,
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

describe("DistillationAgent - additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarizePlan / summarizeExecution / summarizeRemediation field-aware rendering", () => {
    it("renders Plan, Execution, and Remediation summaries into the prompt, including overflow and fallback branches", async () => {
      const deps = buildDeps();

      const manySteps = Array.from({ length: 13 }, (_, i) => ({
        id: `s${i + 1}`,
        title: `Step ${i + 1}`,
        description: i === 0 ? "" : `Description for step ${i + 1}`,
      }));
      const manyAssumptions = Array.from({ length: 9 }, (_, i) => `Assumption ${i + 1}`);

      const planArtifact = {
        id: "plan-artifact-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "A thorough plan summary.",
          assumptions: manyAssumptions,
          openQuestions: [],
          risks: [],
          steps: manySteps,
          testPlan: "Run the full suite.",
          confidence: 0.8,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const manyFiles = Array.from({ length: 41 }, (_, i) => `src/file${i}.ts`);
      const manyNotes = Array.from({ length: 16 }, (_, i) => `Note ${i + 1}`);
      const executionArtifact = {
        ...deps.executionArtifact,
        payloadJson: {
          ...deps.executionArtifact.payloadJson,
          filesChanged: manyFiles,
          notes: manyNotes,
          checks: {
            lint: { status: "fail", details: "Unused variable in auth.ts" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
        },
      };

      const manyResolutions = Array.from({ length: 16 }, (_, i) => ({
        findingId: `f${i + 1}`,
        status: "accepted" as const,
        action: `Fixed finding ${i + 1}`,
        rationale: i === 0 ? "" : `Rationale for finding ${i + 1}`,
      }));
      const remediationArtifact = {
        id: "remediation-artifact-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          resolution: manyResolutions,
          readyForHumanReview: true,
          executionReport: executionArtifact.payloadJson,
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

      // Seed an existing skill that is active but not similar enough to trip the
      // novelty gate, so the existingSkillsSummary non-empty branch is exercised.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        {
          id: "skill-unrelated",
          repoSlug: "test-repo",
          name: "unrelated-skill",
          taskCategory: "totally unrelated topic",
          skillMarkdown: "Completely different subject matter with no overlap whatsoever.",
        },
      ]);

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "just checking prompt" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);

      // Plan summary
      expect(capturedPrompt).toContain("**Summary**: A thorough plan summary.");
      expect(capturedPrompt).toContain("**Confidence**: 0.80");
      expect(capturedPrompt).toContain("…and 1 more steps");
      expect(capturedPrompt).toContain("…and 1 more"); // assumptions overflow (9 - 8 = 1)

      // Execution summary
      expect(capturedPrompt).toContain("- lint: fail — Unused variable in auth.ts");
      expect(capturedPrompt).toContain("- typecheck: pass");
      expect(capturedPrompt).not.toContain("- typecheck: pass — ok");
      expect(capturedPrompt).toContain("…and 1 more"); // filesChanged overflow (41 - 40 = 1)

      // Remediation summary
      expect(capturedPrompt).toContain("## Remediation Summary");
      expect(capturedPrompt).toContain("**Ready for human review**: true");

      // existingSkillsSummary non-empty branch
      expect(capturedPrompt).toContain("unrelated-skill");
    });

    it("falls back to truncated JSON when the Plan artifact payload does not match PlanSchema", async () => {
      const deps = buildDeps();

      const malformedPlanArtifact = {
        id: "plan-artifact-bad",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: { notAPlan: true },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(malformedPlanArtifact);
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "malformed plan check" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain('"notAPlan":true');
    });

    it("falls back to truncated JSON when the Remediation artifact payload does not match RemediationSchema", async () => {
      const deps = buildDeps();

      const malformedRemediationArtifact = {
        id: "remediation-artifact-bad",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: { notRemediation: true },
        rawText: "{}",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Remediation") return Promise.resolve(malformedRemediationArtifact);
        return Promise.resolve(null);
      });

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "malformed remediation check" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(capturedPrompt).toContain("## Remediation Summary");
      expect(capturedPrompt).toContain('"notRemediation":true');
    });
  });

  describe("summarizePlan / summarizeExecution / summarizeRemediation empty-list ('_none_') branches", () => {
    it("renders '_none_' for Plan steps, ExecutionReport filesChanged, and Remediation resolutions when each is empty", async () => {
      const deps = buildDeps();

      const planArtifact = {
        id: "plan-artifact-empty",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Empty-steps plan.",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "N/A",
          confidence: 0.5,
        },
        rawText: "{}",
        createdAt: new Date(),
      };

      const executionArtifact = {
        ...deps.executionArtifact,
        payloadJson: { ...deps.executionArtifact.payloadJson, filesChanged: [] },
      };

      const remediationArtifact = {
        id: "remediation-artifact-empty",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "review-1",
          resolution: [],
          readyForHumanReview: true,
          executionReport: executionArtifact.payloadJson,
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

      let capturedPrompt = "";
      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          capturedPrompt = opts.prompt;
          return makeDistillationOutput({ shouldPersist: false, reason: "empty lists check" });
        },
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      // Each of the three "_none_" fallbacks should appear since every list is empty.
      const noneCount = (capturedPrompt.match(/_none_/g) ?? []).length;
      expect(noneCount).toBeGreaterThanOrEqual(3);
      expect(capturedPrompt).toContain("**Files Changed** (0):\n_none_");
    });
  });

  describe("(7) Headroom gate: missing required skill fields", () => {
    it("skips persisting and logs a warning when shouldPersist=true but taskCategory is blank", async () => {
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

      expect(deps.logger.warn).toHaveBeenCalledWith(
        { runId: "run-1" },
        "Distillation missing taskCategory or skillMarkdown, skipping persist",
      );
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

    it("skips persisting when shouldPersist=true but skillMarkdown is missing entirely", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
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

  describe("(7b) Description fallback", () => {
    it("falls back to a generated description when decision.description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT RS256.",
          description: "   ",
        }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ repo: "acme/widgets" });
      await agent.run("run-1", run);

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on auth middleware in acme/widgets.",
        }),
      );
    });

    it("falls back to a generated description when decision.description is entirely absent", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "db migrations",
          skillMarkdown: "Always wrap migrations in a transaction.",
        }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ repo: "acme/widgets" });
      await agent.run("run-1", run);

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Use when working on db migrations in acme/widgets.",
        }),
      );
    });

    it("uses the trimmed decision.description when it is meaningfully present", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT RS256.",
          description: "  A real, specific description.  ",
        }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "A real, specific description.",
        }),
      );
    });
  });
});
