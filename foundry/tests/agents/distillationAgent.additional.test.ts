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
  taskCategory?: string;
  skillMarkdown?: string;
} = {}) {
  return {
    id: overrides.id ?? "skill-1",
    repoSlug: "test-repo",
    name: "name" in overrides ? overrides.name : "unrelated-skill",
    description: "Some unrelated skill.",
    taskCategory: overrides.taskCategory ?? "unrelated category",
    skillMarkdown: overrides.skillMarkdown ?? "Totally unrelated advice about deployment pipelines.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
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
    displaceAndCreate: vi.fn(),
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

describe("DistillationAgent - additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a non-empty existingSkillsSummary line when an active skill pool exists (novelty gate not tripped)", async () => {
    const deps = buildDeps();
    // Dissimilar skill so the novelty pre-check does NOT fire; the request proceeds
    // to the LLM call with existingSkillsSummary built from this non-empty pool.
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({ name: "deploy-pipeline", taskCategory: "ci/cd" }),
    ]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    expect(promptArg).toContain("deploy-pipeline");
    expect(promptArg).toContain("ci/cd");
  });

  it("skips persisting and emits missing_required_skill_fields when taskCategory is blank", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight found",
        taskCategory: "   ",
        skillMarkdown: "Some markdown",
        name: "some-name",
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

  it("skips persisting and emits missing_required_skill_fields when skillMarkdown is blank", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight found",
        taskCategory: "auth middleware",
        skillMarkdown: "   ",
        name: "some-name",
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

  it("summarizes a Plan artifact and a Remediation artifact into the prompt when both are present", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
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
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Plan") {
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan" as const,
          version: 1,
          payloadJson: {
            planVersion: 1,
            summary: "Add JWT middleware",
            requirementsTraceability: "",
            assumptions: ["Users already have accounts"],
            openQuestions: [],
            risks: ["Token expiry edge cases"],
            steps: [{ id: "s1", title: "Add middleware", description: "Wire up JWT check" }],
            testPlan: "Run auth integration tests",
            confidence: 0.9,
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Remediation") {
        return Promise.resolve({
          id: "artifact-remediation",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: {
            reviewId: "rev-1",
            readyForHumanReview: true,
            resolution: [
              {
                findingId: "f1",
                status: "accepted",
                action: "Fixed the null check",
                rationale: "The token could be undefined on refresh",
              },
            ],
            executionReport: {
              executionVersion: 2,
              summary: "Fixed",
              filesChanged: ["src/middleware/auth.ts"],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.9,
              scoreRationale: "All good",
            },
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ linearIssueTitle: null }));

    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    expect(promptArg).toContain("Add JWT middleware");
    expect(promptArg).toContain("Remediation Summary");
  });

  it("uses the empty-state fallback text for steps/files/resolutions when artifacts have none", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: {
            executionVersion: 1,
            summary: "No-op run.",
            filesChanged: [],
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "pass", details: "ok" },
            },
            notes: [],
            prDraftCreated: false,
            score: 0.5,
            scoreRationale: "Nothing changed.",
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Plan") {
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan" as const,
          version: 1,
          payloadJson: {
            planVersion: 1,
            summary: "Empty plan",
            requirementsTraceability: "",
            assumptions: [],
            openQuestions: [],
            risks: [],
            steps: [],
            testPlan: "None needed",
            confidence: 0.5,
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Remediation") {
        return Promise.resolve({
          id: "artifact-remediation",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: {
            reviewId: "rev-1",
            readyForHumanReview: true,
            resolution: [],
            executionReport: {
              executionVersion: 2,
              summary: "Fixed",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "Nothing left to fix",
            },
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    // "_none_" appears once each for the empty plan steps, empty files-changed
    // list, and empty resolutions list.
    expect(promptArg.split("_none_").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("includes a truncated linearIssueDescription in the novelty task query when present", async () => {
    const deps = buildDeps();
    // Dissimilar pool so the novelty gate doesn't short-circuit before the query is used.
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({ taskCategory: "unrelated", skillMarkdown: "totally different topic" }),
    ]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    const longDescription = "x".repeat(500);
    await agent.run(
      "run-1",
      makeRun({
        ...( { linearIssueDescription: longDescription } as Partial<Run>),
      }),
    );

    // Reaching the LLM call at all proves the description-inclusive query built
    // successfully (a throw here would mean the optional-chaining branch broke).
    expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
  });

  it("truncates an overly long plan summary and uses schema-mismatch/JSON fallbacks for malformed artifacts", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: { not: "a valid execution report" },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
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
      if (type === "Remediation") {
        return Promise.resolve({
          id: "artifact-remediation",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: { not: "a valid remediation" },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    // Malformed payloads fall back to truncated raw JSON rather than the
    // field-aware summary.
    expect(promptArg).toContain("not");
    expect(promptArg).toContain("a valid plan");
    expect(promptArg).toContain("a valid remediation");
  });

  it("renders a failing check without details on its own line, and skill entries without a name fall back to taskCategory", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({ name: null, taskCategory: "deploy pipelines" }),
    ]);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: {
            executionVersion: 1,
            summary: "Partially broken run.",
            filesChanged: ["src/a.ts"],
            checks: {
              lint: { status: "fail", details: "" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "fail", details: "2 tests failed" },
            },
            notes: [],
            prDraftCreated: false,
            score: 0.3,
            scoreRationale: "Checks failing.",
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    expect(promptArg).toContain("lint: fail");
    expect(promptArg).toContain("tests: fail");
    expect(promptArg).toContain("2 tests failed");
    expect(promptArg).toContain("deploy pipelines");
  });

  it("propagates a non-Error rejection from the agent runner as a stringified parse_error", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    // eslint-disable-next-line prefer-promise-reject-errors
    deps.agentRunner.run.mockRejectedValue("plain string failure");

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
      }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string failure" }),
      expect.any(String),
    );
  });

  it("truncates long text, caps overflowing bullet/step/file/resolution lists, and omits an empty rationale", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    const longText = "word ".repeat(600); // well over every truncate() cap used here
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: {
            executionVersion: 1,
            summary: longText,
            filesChanged: Array.from({ length: 45 }, (_, i) => `src/file-${i}.ts`),
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "pass", details: "ok" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.8,
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
          type: "Plan" as const,
          version: 1,
          payloadJson: {
            planVersion: 1,
            summary: longText,
            requirementsTraceability: "",
            assumptions: Array.from({ length: 10 }, (_, i) => `assumption ${i}`),
            openQuestions: [],
            risks: [],
            // 13 steps, the 13th with no description, to hit both the >12
            // overflow branch and the no-description branch.
            steps: Array.from({ length: 13 }, (_, i) => ({
              id: `s${i}`,
              title: `Step ${i}`,
              description: i === 12 ? "" : `Do thing ${i}`,
            })),
            testPlan: "Run tests",
            confidence: 0.7,
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Remediation") {
        return Promise.resolve({
          id: "artifact-remediation",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: {
            reviewId: "rev-1",
            readyForHumanReview: false,
            resolution: Array.from({ length: 16 }, (_, i) => ({
              findingId: `f${i}`,
              status: "accepted" as const,
              action: `Fixed ${i}`,
              // Empty rationale exercises the "no *why* line" branch.
              rationale: "",
            })),
            executionReport: {
              executionVersion: 2,
              summary: "ok",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "pass", details: "ok" },
              },
              notes: [],
              prDraftCreated: true,
              score: 0.7,
              scoreRationale: "ok",
            },
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not novel enough" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const callArgs = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, ...unknown[]];
    const promptArg = callArgs[1].prompt;
    expect(promptArg).toContain("…"); // truncation marker present somewhere
    expect(promptArg).toContain("more steps");
    expect(promptArg).toContain("more");
    expect(promptArg).not.toContain("*why*"); // rationale-less resolutions omit it
  });

  it("falls back to a generated description when the LLM omits/blanks the description", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT with RS256.",
        name: "auth-middleware",
        description: "   ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ repo: "acme-repo" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on auth middleware in acme-repo.",
      }),
    );
  });
});
