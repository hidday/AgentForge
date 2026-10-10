import { describe, it, expect, vi } from "vitest";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

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

function buildAgent() {
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw executor transcript",
        parsed: {
          stage: "executor" as const,
          payload: {
            executionVersion: 1,
            summary: "done",
            filesChanged: [],
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "pass", details: "ok" },
            },
            notes: [],
            prDraftCreated: true,
            score: 0.8,
            scoreRationale: "fine",
          },
        },
      };
    }),
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

  return { agent, logger, getUserPrompt: () => capturedUserPrompt };
}

describe("ExecutorAgent.run() operator note section", () => {
  it("injects the Operator Note section into the user prompt when options.operatorNote is set", async () => {
    const { agent, getUserPrompt, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Please double-check the auth flow.",
    });

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("## Operator Note");
    expect(userPrompt).toContain("Please double-check the auth flow.");
    expect(userPrompt).toContain("high-priority clarification");

    const startLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Starting executor agent");
    expect((startLog?.[0] as Record<string, unknown>)?.hasOperatorNote).toBe(true);
  });

  it("omits the Operator Note section when no operatorNote is provided", async () => {
    const { agent, getUserPrompt, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const userPrompt = getUserPrompt();
    expect(userPrompt).not.toContain("## Operator Note");

    const startLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Starting executor agent");
    expect((startLog?.[0] as Record<string, unknown>)?.hasOperatorNote).toBe(false);
  });
});
