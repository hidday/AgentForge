import { describe, it, expect, vi } from "vitest";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

// Covers the operatorNote branch of ExecutorAgent.run() not exercised by
// executorAgent.test.ts (which never passes `options.operatorNote`).

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
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw executor transcript",
          parsed: { stage: "executor" as const, payload: makeReport() },
        };
      },
    ),
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

  return { agent, getUserPrompt: () => capturedUserPrompt };
}

describe("ExecutorAgent.run() operatorNote", () => {
  it("renders the Operator Note section with the note text when options.operatorNote is set", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Please double-check the rate limiter config.",
    });

    const prompt = getUserPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Please double-check the rate limiter config.");
    expect(prompt).toContain("high-priority clarification");
  });

  it("omits the Operator Note section when no operatorNote is provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("## Operator Note");
  });
});
