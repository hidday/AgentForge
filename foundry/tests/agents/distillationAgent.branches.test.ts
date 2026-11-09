import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the field-aware summarizer helpers (summarizePlan, summarizeExecution,
// summarizeRemediation, truncate, bulletList) and several branches in run() that
// distillationAgent.test.ts never exercises: a Plan artifact being present, a
// Remediation artifact being present, non-empty existing-skills summaries,
// nullish-coalescing fallbacks on the run's Linear fields, a non-Error throw
// from the agent runner, and the "missing required skill fields" / "blank
// description fallback" guards.

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

function makeExecutionArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-exec",
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
      ...overrides,
    },
    rawText: '{"outcome":"success"}',
    createdAt: new Date(),
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

  const executionArtifact = makeExecutionArtifact();

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

function capturedPrompt(deps: ReturnType<typeof buildDeps>): string {
  const call = (deps.agentRunner.run as ReturnType<typeof vi.fn>).mock.calls[0];
  return (call[1] as { prompt: string }).prompt;
}

describe("DistillationAgent branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("summarizePlan via a present Plan artifact", () => {
    it("renders summary/confidence/assumptions/risks/steps/testPlan, capping long lists", async () => {
      const deps = buildDeps();
      const manySteps = Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Do step ${i}`,
      }));
      const manyAssumptions = Array.from({ length: 10 }, (_, i) => `assumption ${i}`);
      const manyRisks = Array.from({ length: 10 }, (_, i) => `risk ${i}`);

      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact());
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan" as const,
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "Add JWT middleware to the auth pipeline.",
              assumptions: manyAssumptions,
              openQuestions: [],
              risks: manyRisks,
              steps: manySteps,
              testPlan: "Run the auth integration suite.",
              confidence: 0.77,
            },
            rawText: "{}",
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

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("**Confidence**: 0.77");
      expect(prompt).toContain("**Summary**: Add JWT middleware to the auth pipeline.");
      // 14 steps > the 12-step cap
      expect(prompt).toContain("…and 2 more steps");
      // 10 assumptions/risks > the 8-item cap
      expect(prompt).toContain("…and 2 more");
      expect(prompt).toContain("1. Step 0");
    });

    it("falls back to truncated JSON when the Plan artifact payload doesn't match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact());
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: "run-1",
            type: "Plan" as const,
            version: 1,
            payloadJson: { not: "a valid plan" },
            rawText: "{}",
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

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain('{"not":"a valid plan"}');
    });
  });

  describe("summarizeExecution branches", () => {
    it("renders '_none_' for filesChanged when the array is empty", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve(makeExecutionArtifact({ filesChanged: [] }));
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("**Files Changed** (0):\n_none_");
    });

    it("caps filesChanged display at 40 and appends an '…and N more' marker", async () => {
      const deps = buildDeps();
      const manyFiles = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve(makeExecutionArtifact({ filesChanged: manyFiles }));
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("- …and 5 more");
    });

    it("includes failing check details and omits them for passing checks", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve(
            makeExecutionArtifact({
              checks: {
                lint: { status: "pass", details: "should not appear" },
                typecheck: { status: "fail", details: "Type 'X' is not assignable to 'Y'." },
                tests: { status: "fail", details: "" },
              },
            }),
          );
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("- lint: pass");
      expect(prompt).not.toContain("should not appear");
      expect(prompt).toContain("- typecheck: fail — Type 'X' is not assignable to 'Y'.");
      // Failing with empty details must not append a dangling " — "
      expect(prompt).toContain("- tests: fail\n");
    });

    it("caps notes display at 15 entries", async () => {
      const deps = buildDeps();
      const manyNotes = Array.from({ length: 18 }, (_, i) => `note ${i}`);
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve(makeExecutionArtifact({ notes: manyNotes }));
        }
        return Promise.resolve(null);
      });
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("- note 0");
      expect(prompt).toContain("…and 3 more");
    });
  });

  describe("summarizeRemediation via a present Remediation artifact", () => {
    it("renders readyForHumanReview, final score, and capped resolution list", async () => {
      const deps = buildDeps();
      const manyResolutions = Array.from({ length: 17 }, (_, i) => ({
        findingId: `F${i}`,
        status: "accepted" as const,
        action: `Fixed finding ${i}`,
        rationale: `Because ${i}`,
      }));
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact());
        if (type === "Remediation") {
          return Promise.resolve({
            id: "artifact-remediation",
            runId: "run-1",
            type: "Remediation" as const,
            version: 1,
            payloadJson: {
              reviewId: "review-1",
              resolution: manyResolutions,
              readyForHumanReview: true,
              executionReport: makeExecutionArtifact().payloadJson,
            },
            rawText: "{}",
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

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("**Ready for human review**: true");
      expect(prompt).toContain("- [accepted] F0: Fixed finding 0");
      expect(prompt).toContain("*why*: Because 0");
      expect(prompt).toContain("…and 2 more");
    });

    it("falls back to truncated JSON when the Remediation payload doesn't match the schema", async () => {
      const deps = buildDeps();
      deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact());
        if (type === "Remediation") {
          return Promise.resolve({
            id: "artifact-remediation",
            runId: "run-1",
            type: "Remediation" as const,
            version: 1,
            payloadJson: { bogus: true },
            rawText: "{}",
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

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("## Remediation Summary");
      expect(prompt).toContain('{"bogus":true}');
    });
  });

  describe("task query / taskCategory_hint nullish fallbacks", () => {
    it("falls back to an empty title and task category hint when linearIssueTitle is null", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      const run = makeRun({ linearIssueTitle: null });
      await agent.run("run-1", run);

      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("- **Task Category Hint**: ");
    });

    it("includes linearIssueDescription (sliced into the task query) when present", async () => {
      const deps = buildDeps();
      // The Run domain type has no linearIssueDescription field; the agent reads it
      // defensively via an unsafe cast. Set it via an unsafe cast here to exercise
      // the branch where that optional chain actually resolves to a string.
      const run = {
        ...makeRun({ linearIssueTitle: "Short title" }),
        linearIssueDescription:
          "zzqqxv-unique-marker-phrase describing a very specific caching bug in detail",
      } as unknown as Run;

      // An existing skill whose content overlaps heavily with the description
      // (but not the title) only trips the novelty gate if the task query used
      // to score novelty actually incorporated the description text.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          taskCategory: "caching",
          skillMarkdown:
            "zzqqxv-unique-marker-phrase describing a very specific caching bug in detail",
        }),
      ]);

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
  });

  describe("existingSkillsSummary with active skills present", () => {
    it("lists active skills (falling back to taskCategory when name is null) without tripping the novelty gate", async () => {
      const deps = buildDeps();
      // Deliberately unrelated to the task query so maxNoveltyOverlap stays low.
      deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
        makeSkill({
          id: "skill-unrelated",
          name: null,
          taskCategory: "unrelated subsystem",
          skillMarkdown: "Totally unrelated content about caching invalidation rules.",
        }),
      ]);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({ shouldPersist: false, reason: "n/a" }),
      );

      const agent = buildAgent(deps);
      await agent.run(
        "run-1",
        makeRun({ linearIssueTitle: "Completely different feature work" }),
      );

      expect(deps.agentRunner.run).toHaveBeenCalled();
      const prompt = capturedPrompt(deps);
      expect(prompt).toContain("[unrelated subsystem] unrelated subsystem:");
    });
  });

  describe("LLM call throws a non-Error value", () => {
    it("still emits a parse_error event using String(err)", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockRejectedValue("a plain string rejection");

      const agent = buildAgent(deps);
      await agent.run("run-1", makeRun());

      expect(deps.eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
        }),
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "a plain string rejection" }),
        expect.any(String),
      );
    });
  });

  describe("missing required skill fields after shouldPersist=true", () => {
    it("skips persisting and emits missing_required_skill_fields when taskCategory is blank", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "looks useful",
          taskCategory: "   ",
          skillMarkdown: "Some generalized lesson.",
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

    it("skips persisting when skillMarkdown is blank even if taskCategory is present", async () => {
      const deps = buildDeps();
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "looks useful",
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

  describe("description fallback when the LLM provides a blank description", () => {
    it("derives a default description from taskCategory and repo when description is whitespace-only", async () => {
      const deps = buildDeps();
      deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
      deps.agentRunner.run.mockResolvedValue(
        makeDistillationOutput({
          shouldPersist: true,
          reason: "non-trivial insight",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256 for stateless auth.",
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
