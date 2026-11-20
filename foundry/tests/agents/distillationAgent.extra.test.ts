import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// Additive coverage for distillationAgent.ts branches not exercised by
// distillationAgent.test.ts: the Plan/Remediation-artifact summarizers, the
// "existing skills" listing branch, malformed-payload fallbacks, non-Error
// rejections, and the missing-required-field / blank-description paths.

function makeRun(overrides: Partial<Run> & { linearIssueDescription?: string } = {}): Run {
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
  } as Run;
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

describe("DistillationAgent (additional branch coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("(j) Plan + Remediation artifacts present, large lists, failing check, existing skills, long description", () => {
    it("exercises summarizePlan/summarizeRemediation and all their overflow/truncation branches", async () => {
      const deps = buildDeps();

      const planArtifact = {
        id: "plan-1",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "x".repeat(700),
          assumptions: Array.from({ length: 10 }, (_, i) => `assumption ${i}`),
          openQuestions: [],
          risks: Array.from({ length: 10 }, (_, i) => `risk ${i}`),
          steps: Array.from({ length: 14 }, (_, i) => ({
            id: `s${i}`,
            title: `Step ${i}`,
            description: "y".repeat(250),
          })),
          testPlan: "z".repeat(450),
          confidence: 0.75,
        },
        rawText: "plan",
        createdAt: new Date(),
      };

      const remediationArtifact = {
        id: "rem-1",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: Array.from({ length: 18 }, (_, i) => ({
            findingId: `f${i}`,
            status: "accepted" as const,
            action: `Fixed finding ${i}`,
            rationale: `Because ${i} was a real bug`,
          })),
          readyForHumanReview: true,
          executionReport: {
            executionVersion: 2,
            summary: "Post-remediation",
            filesChanged: Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`),
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "fail", details: "1 flaky test" },
            },
            notes: Array.from({ length: 20 }, (_, i) => `note ${i}`),
            prDraftCreated: true,
            score: 0.6,
            scoreRationale: "Still one failing check.",
          },
        },
        rawText: "remediation",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });

      // A dissimilar existing skill (so the novelty gate still passes), with
      // name=null to exercise the `s.name ?? s.taskCategory` fallback.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          name: null,
          taskCategory: "database migration",
          skillMarkdown: "Run alembic migrations in strict order.",
        }),
      ]);
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(1);

      deps.agentRunner.run.mockImplementation(
        async (_runtime: unknown, opts: { prompt: string }) => {
          // Capture the rendered prompt so we can assert on it below.
          return makeDistillationOutput({
            shouldPersist: true,
            reason: "non-trivial insight",
            name: "auth-middleware",
            description: "Use when adding JWT auth middleware.",
            skillMarkdown: "Use JWT with RS256 for stateless auth.",
            taskCategory: "auth middleware",
          });
        },
      );

      const agent = buildAgent(deps);
      const run = makeRun({
        linearIssueTitle: null as unknown as string,
        linearIssueDescription: "y".repeat(300),
      });

      await agent.run("run-1", run);

      // Reached the LLM call (novelty gate passed) and persisted the skill.
      expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("…and 2 more steps");
      expect(promptArg).toContain("…and 2 more");
      expect(promptArg).toContain("database migration");

      expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskCategory: "auth middleware" }),
      );
    });
  });

  describe("(k0) Plan with no steps and Remediation with no resolutions render the empty-list placeholder", () => {
    it("uses '_none_' for an empty steps array and an empty resolution array", async () => {
      const deps = buildDeps();

      const planArtifact = {
        id: "plan-empty",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: {
          planVersion: 1,
          summary: "Trivial plan",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [],
          testPlan: "none needed",
          confidence: 0.9,
        },
        rawText: "plan",
        createdAt: new Date(),
      };

      const remediationArtifact = {
        id: "rem-empty",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: {
          reviewId: "rev-1",
          resolution: [],
          readyForHumanReview: true,
          executionReport: {
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
            score: 1,
            scoreRationale: "Nothing left to fix.",
          },
        },
        rawText: "remediation",
        createdAt: new Date(),
      };

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") return Promise.resolve(planArtifact);
        if (type === "Remediation") return Promise.resolve(remediationArtifact);
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      const noneCount = promptArg.split("_none_").length - 1;
      // Plan steps and Remediation resolution-list both render "_none_".
      expect(noneCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("(k) ExecutionReport with no changed files renders the empty-list placeholder", () => {
    it("uses the '_none_' fallback for filesChanged", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson.filesChanged = [];
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "no changes to generalize" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain("_none_");
    });
  });

  describe("(l) Malformed artifact payloads fall back to truncated JSON", () => {
    it("falls back for an unparseable Plan artifact", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-bad",
            runId: "run-1",
            type: "Plan" as const,
            version: 1,
            payloadJson: { not: "a valid plan" },
            rawText: "bad plan",
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
      expect(promptArg).toContain("not");
      expect(promptArg).toContain("a valid plan");
    });

    it("falls back for an unparseable ExecutionReport artifact", async () => {
      const deps = buildDeps();
      deps.executionArtifact.payloadJson = { not: "a valid execution report" } as never;
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const promptArg = (deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }])[1]
        .prompt;
      expect(promptArg).toContain('"not":"a valid execution report"');
    });

    it("falls back for an unparseable Remediation artifact", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
        if (type === "Remediation") {
          return Promise.resolve({
            id: "rem-bad",
            runId: "run-1",
            type: "Remediation" as const,
            version: 1,
            payloadJson: { not: "a valid remediation" },
            rawText: "bad remediation",
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
      expect(promptArg).toContain('"not":"a valid remediation"');
    });
  });

  describe("(m) Non-Error rejection from the LLM call", () => {
    it("stringifies a non-Error rejection reason and still emits parse_error", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("timeout string, not an Error");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ reason: "parse_error" }),
        }),
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "timeout string, not an Error" }),
        expect.stringContaining("Distillation LLM call failed"),
      );
    });
  });

  describe("(n) shouldPersist=true but required fields are missing", () => {
    it("skips persistence with reason=missing_required_skill_fields when taskCategory is blank", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "   ",
          skillMarkdown: "Some markdown",
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

    it("skips persistence with reason=missing_required_skill_fields when skillMarkdown is absent", async () => {
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
            shouldPersist: false,
            reason: "missing_required_skill_fields",
          }),
        }),
      );
    });
  });

  describe("(o) Blank description falls back to a generated one", () => {
    it("generates 'Use when working on <taskCategory> in <repo>.' when description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "insight found",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT.",
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
