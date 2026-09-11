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

function makeReport(): ExecutionReport {
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
  };
}

function buildAgent() {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw executor transcript",
          parsed: { stage: "executor" as const, payload: makeReport() },
        };
      },
    ),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const githubClient = { createDraftPR: vi.fn().mockResolvedValue(101) };
  const gitService = { commitAndPush: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ExecutorAgent(
    agentRunner as never,
    artifactRepo as never,
    githubClient as never,
    gitService as never,
    logger as never,
  );

  return {
    agent,
    logger,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
  };
}

describe("ExecutorAgent.run() operator note rendering", () => {
  it("injects the operator note into the rendered user prompt when provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Prioritize backward compatibility for the public API.",
    });

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("## Operator Note");
    expect(userPrompt).toContain("Prioritize backward compatibility for the public API.");
    expect(userPrompt).toContain("high-priority clarification");
  });

  it("logs hasOperatorNote: true when an operator note is provided", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "note",
    });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);
  });

  it("omits the operator note section and logs hasOperatorNote: false when absent", async () => {
    const { agent, getUserPrompt, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const userPrompt = getUserPrompt();
    expect(userPrompt).not.toContain("## Operator Note");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(false);
  });
});

describe("ExecutorAgent.run() isRetry logging branches", () => {
  it("logs isRetry: true when only retry.existingBranch is set (no existingPR)", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { existingBranch: "ai/lin-1" });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect((startLog?.[0] as Record<string, unknown>).isRetry).toBe(true);
  });

  it("logs isRetry: true when only retry.existingPR is set (no existingBranch)", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { existingPR: 555 });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect((startLog?.[0] as Record<string, unknown>).isRetry).toBe(true);
  });

  it("logs isRetry: false when retry is entirely omitted", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect((startLog?.[0] as Record<string, unknown>).isRetry).toBe(false);
  });
});
