import { describe, it, expect, vi } from "vitest";
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

function buildDeps(decision: Record<string, unknown>) {
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
      scoreRationale: "Implementation matches plan.",
    },
    rawText: "{}",
    createdAt: new Date(),
  };

  const artifactRepo = {
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
      return Promise.resolve(null);
    }),
    findByRunId: vi.fn(),
    create: vi.fn(),
  };
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw output",
      parsed: { stage: "distillation" as const, payload: decision },
    }),
  };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: "new-skill-1" }),
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
  const config = { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 0.95 };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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

describe("DistillationAgent headroom gate guard clauses", () => {
  it("skips persisting and logs a warning when shouldPersist=true but taskCategory is missing", async () => {
    const deps = buildDeps({
      shouldPersist: true,
      reason: "insight",
      skillMarkdown: "Some markdown",
      // taskCategory intentionally omitted
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
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

  it("skips persisting when shouldPersist=true but skillMarkdown is only whitespace", async () => {
    const deps = buildDeps({
      shouldPersist: true,
      reason: "insight",
      taskCategory: "auth",
      skillMarkdown: "   ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ reason: "missing_required_skill_fields" }),
      }),
    );
  });

  it("falls back to a generated description when the model omits description", async () => {
    const deps = buildDeps({
      shouldPersist: true,
      reason: "insight",
      taskCategory: "auth middleware",
      skillMarkdown: "Use JWT tokens.",
      // description intentionally omitted
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on auth middleware in test-repo.",
      }),
    );
  });

  it("falls back to a generated description when the model's description is whitespace-only", async () => {
    const deps = buildDeps({
      shouldPersist: true,
      reason: "insight",
      taskCategory: "auth middleware",
      skillMarkdown: "Use JWT tokens.",
      description: "   ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on auth middleware in test-repo.",
      }),
    );
  });
});
