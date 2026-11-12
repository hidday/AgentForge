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
    id: "new-skill-1",
    repoSlug: "test-repo",
    name: "some-skill",
    description: "desc",
    taskCategory: "cat",
    skillMarkdown: "md",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
    ...overrides,
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
    parsed: { stage: "distillation" as const, payload: decision },
  };
}

function buildDeps() {
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
  const config = { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 0.5 };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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

  return { agentRunner, artifactRepo, agentSkillRepo, eventRepo, config, logger };
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

describe("DistillationAgent — missing required skill fields gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips persistence and emits reason='missing_required_skill_fields' when shouldPersist=true but taskCategory is missing", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "found something useful",
        skillMarkdown: "Some markdown body.",
        // taskCategory intentionally omitted
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
        eventType: "SKILL_DISTILLATION",
        payloadJson: expect.objectContaining({
          shouldPersist: false,
          reason: "missing_required_skill_fields",
          displacedSkillId: null,
        }),
      }),
    );
  });

  it("skips persistence when shouldPersist=true but skillMarkdown is missing", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "found something useful",
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

  it("skips persistence when taskCategory is whitespace-only (trims to empty)", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "found something useful",
        taskCategory: "   ",
        skillMarkdown: "Some markdown body.",
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

describe("DistillationAgent — description fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to a generated description when decision.description is undefined", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT with RS256.",
        name: "auth-middleware",
        // description intentionally omitted
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on auth middleware in acme/widgets.",
      }),
    );
  });

  it("falls back to a generated description when decision.description is whitespace-only", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "database migration",
        skillMarkdown: "Run migrations in order.",
        description: "   ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on database migration in acme/widgets.",
      }),
    );
  });

  it("uses the trimmed decision.description verbatim when it is a non-empty string", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "database migration",
        skillMarkdown: "Run migrations in order.",
        description: "  Use when running Alembic migrations.  ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when running Alembic migrations.",
      }),
    );
  });
});
