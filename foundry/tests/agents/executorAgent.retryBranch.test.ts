import { describe, it, expect, vi } from "vitest";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

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

  const gitService = { commitAndPush: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ExecutorAgent(
    agentRunner as never,
    artifactRepo as never,
    githubClient as never,
    gitService as never,
    logger as never,
  );

  return { agent, logger, githubClient };
}

function getStartLog(logger: { info: ReturnType<typeof vi.fn> }) {
  const call = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Starting executor agent");
  return call?.[0] as Record<string, unknown> | undefined;
}

describe("ExecutorAgent.run() — isRetry OR-branch combinations", () => {
  it("treats the run as a retry when only existingPR is set (existingBranch absent)", async () => {
    const { agent, logger, githubClient } = buildAgent();

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1", { existingPR: 777 });

    expect(getStartLog(logger)?.isRetry).toBe(true);
    expect(result.prNumber).toBe(777);
    expect(githubClient.createDraftPR).not.toHaveBeenCalled();
  });

  it("treats the run as a retry when only existingBranch is set (existingPR absent), still creating a new PR", async () => {
    const { agent, logger, githubClient } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { existingBranch: "ai/lin-1-retry" });

    expect(getStartLog(logger)?.isRetry).toBe(true);
    expect(githubClient.createDraftPR).toHaveBeenCalledWith(
      "test-repo",
      "ai/lin-1-retry",
      "main",
      expect.any(String),
      expect.any(String),
    );
  });

  it("treats the run as a non-retry when neither existingBranch nor existingPR is set", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(getStartLog(logger)?.isRetry).toBe(false);
  });
});
