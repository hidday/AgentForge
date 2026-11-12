import { describe, it, expect, vi } from "vitest";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

/**
 * Covers the `isRetry` boundary logic in ExecutorAgent.run() (line 39):
 *   isRetry: retry?.existingBranch != null || retry?.existingPR != null
 * The existing executorAgent.test.ts only exercises the case where BOTH
 * existingBranch and existingPR are set (true || true). This file exercises
 * the remaining combinations: neither set, only existingBranch set, and
 * only existingPR set.
 */

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
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
}

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "42 tests passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Implementation looks solid.",
    ...overrides,
  };
}

function buildAgent() {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw executor transcript",
      parsed: { stage: "executor" as const, payload: makeReport() },
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const githubClient = {
    createDraftPR: vi.fn().mockResolvedValue(101),
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn(),
  };

  const gitService = {
    commitAndPush: vi.fn().mockResolvedValue(undefined),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new ExecutorAgent(
    agentRunner as never,
    artifactRepo as never,
    githubClient as never,
    gitService as never,
    logger as never,
  );

  return { agent, agentRunner, artifactRepo, githubClient, gitService, logger };
}

function startLogPayload(logger: { info: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  const startCall = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Starting executor agent");
  expect(startCall).toBeDefined();
  return startCall![0] as Record<string, unknown>;
}

describe("ExecutorAgent.run() — isRetry logging boundary conditions", () => {
  it("logs isRetry=false when no retry context is passed at all", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(startLogPayload(logger).isRetry).toBe(false);
  });

  it("logs isRetry=false when an empty retry object is passed (both fields undefined)", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {});

    expect(startLogPayload(logger).isRetry).toBe(false);
  });

  it("logs isRetry=false when existingBranch and existingPR are explicitly null", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      existingBranch: null,
      existingPR: null,
    });

    expect(startLogPayload(logger).isRetry).toBe(false);
  });

  it("logs isRetry=true when only existingBranch is set (existingPR absent)", async () => {
    const { agent, logger, githubClient } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      existingBranch: "ai/lin-1-retry",
    });

    expect(startLogPayload(logger).isRetry).toBe(true);
    // existingPR was not set, so a new draft PR is still created.
    expect(githubClient.createDraftPR).toHaveBeenCalledTimes(1);
  });

  it("logs isRetry=true when only existingPR is set (existingBranch absent)", async () => {
    const { agent, logger, githubClient } = buildAgent();

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      existingPR: 777,
    });

    expect(startLogPayload(logger).isRetry).toBe(true);
    expect(result.prNumber).toBe(777);
    expect(githubClient.createDraftPR).not.toHaveBeenCalled();
  });

  it("logs isRetry=true when both existingBranch and existingPR are set", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      existingBranch: "ai/lin-1-retry",
      existingPR: 888,
    });

    expect(startLogPayload(logger).isRetry).toBe(true);
  });

  it("logs hasOperatorNote=true only when options.operatorNote is a non-empty string", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Please double-check edge cases.",
    });

    expect(startLogPayload(logger).hasOperatorNote).toBe(true);
  });
});
