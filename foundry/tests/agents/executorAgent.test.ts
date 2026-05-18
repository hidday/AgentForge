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

function buildAgent(reportOverrides: Partial<ExecutionReport> = {}) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw executor transcript",
          parsed: {
            stage: "executor" as const,
            payload: makeReport(reportOverrides),
          },
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

  return {
    agent,
    agentRunner,
    artifactRepo,
    githubClient,
    gitService,
    logger,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
  };
}

describe("ExecutorAgent.run()", () => {
  it("injects the execution-score rubric into the system prompt", async () => {
    const { agent, getSystemPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt).toContain("Self-Assessment Rubric");
    expect(systemPrompt).toContain("scoreRationale");
    expect(systemPrompt).not.toContain("{{executionScoreRubric}}");
  });

  it("persists an ExecutionReport artifact with version = report.executionVersion", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reportArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ExecutionReport",
    ) as { version: number; payloadJson: { executionVersion: number; score: number } };

    expect(reportArtifact).toBeDefined();
    expect(reportArtifact.version).toBe(1);
    expect(reportArtifact.payloadJson.executionVersion).toBe(1);
    expect(reportArtifact.payloadJson.score).toBe(0.8);
  });

  it("forces executionVersion to 1 even if the model returns a different value", async () => {
    const { agent, artifactRepo } = buildAgent({ executionVersion: 7 });

    const { report } = await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(report.executionVersion).toBe(1);

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reportArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ExecutionReport",
    ) as { version: number };
    expect(reportArtifact.version).toBe(1);
  });

  it("returns the parsed report and the PR number from the github client", async () => {
    const { agent, githubClient } = buildAgent();

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(result.report.score).toBe(0.8);
    expect(result.report.executionVersion).toBe(1);
    expect(result.prNumber).toBe(101);
    expect(githubClient.createDraftPR).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing PR number on retry instead of creating a new draft", async () => {
    const { agent, githubClient } = buildAgent();

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      existingBranch: "ai/lin-1",
      existingPR: 555,
    });

    expect(result.prNumber).toBe(555);
    expect(githubClient.createDraftPR).not.toHaveBeenCalled();
  });

  it("logs the score and executionVersion in the completion event", async () => {
    const { agent, logger } = buildAgent({ score: 0.42 });

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Execution completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.score).toBe(0.42);
    expect(payload?.executionVersion).toBe(1);
  });
});
