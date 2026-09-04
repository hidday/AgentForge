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
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw executor transcript",
        parsed: { stage: "executor" as const, payload: makeReport() },
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

describe("ExecutorAgent.run() operator note handling", () => {
  it("injects the Operator Note section into the user prompt when operatorNote is provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Please prioritize backward compatibility.",
    });

    const prompt = getUserPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Please prioritize backward compatibility.");
    expect(prompt).not.toContain("{{operatorNoteSection}}");
  });

  it("omits the Operator Note section when no operatorNote is given", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("## Operator Note");
  });

  it("logs hasOperatorNote:true and isRetry:true when both a note and retry context are given", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(
      makePlan(),
      makeTaskBundle(),
      "run-1",
      { existingBranch: "ai/lin-1", existingPR: 42 },
      { operatorNote: "Watch out for the migration." },
    );

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    expect(startLog).toBeDefined();
    const payload = startLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.hasOperatorNote).toBe(true);
    expect(payload?.isRetry).toBe(true);
  });

  it("logs isRetry:true when only existingPR (no existingBranch) is set on retry context", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { existingPR: 7 });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    const payload = startLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.isRetry).toBe(true);
  });

  it("logs isRetry:false and hasOperatorNote:false with no retry context and no note", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting executor agent",
    );
    const payload = startLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.hasOperatorNote).toBe(false);
    expect(payload?.isRetry).toBe(false);
  });
});
