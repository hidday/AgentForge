import { describe, it, expect, vi } from "vitest";
import { RemediationAgent } from "../../src/agents/remediationAgent.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeReview(): Review {
  return {
    reviewId: "rev-001",
    summary: "Found a real bug and one nit.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 12,
        title: "Missing null check",
        details: "Will throw if foo is null",
      },
      {
        id: "f2",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Long line",
        details: "Could be split for readability",
      },
    ],
    overallVerdict: "changes_requested",
  };
}

function makePrevReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Initial implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 test failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.55,
    scoreRationale: "One test still failing; covered happy path only.",
    ...overrides,
  };
}

function makeRemediation(
  newReport: Partial<ExecutionReport> = {},
  overrides: Partial<Remediation> = {},
): Remediation {
  const report: ExecutionReport = {
    executionVersion: 2,
    summary: "Post-remediation state.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all tests pass" },
    },
    notes: ["Fixed f1; dismissed f2"],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "Bug fixed, tests now green.",
    ...newReport,
  };
  return {
    reviewId: "rev-001",
    resolution: [
      {
        findingId: "f1",
        status: "accepted",
        action: "Added null guard",
        rationale: "Real bug",
      },
      {
        findingId: "f2",
        status: "rejected",
        action: "No changes made",
        rationale: "Style preference",
      },
    ],
    readyForHumanReview: true,
    executionReport: report,
    ...overrides,
  };
}

function buildAgent(remediationOverride?: Remediation) {
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
          raw: "raw remediation transcript",
          parsed: {
            stage: "remediation" as const,
            payload: remediationOverride ?? makeRemediation(),
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

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new RemediationAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );

  return {
    agent,
    agentRunner,
    artifactRepo,
    logger,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
  };
}

describe("RemediationAgent.run()", () => {
  it("injects the execution-score rubric and the prev/next versions into the prompts", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt).toContain("Self-Assessment Rubric");
    expect(systemPrompt).not.toContain("{{executionScoreRubric}}");
    expect(systemPrompt).toContain("executionVersion: 1");
    expect(systemPrompt).toContain("MUST be `2`");

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("Prior Execution Version**: v1");
    expect(userPrompt).toContain("set `executionVersion` to 2");
  });

  it("writes both an ExecutionReport (vN+1) and a Remediation artifact", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
    }[];

    const reportArtifact = calls.find((a) => a.type === "ExecutionReport");
    expect(reportArtifact).toBeDefined();
    expect(reportArtifact?.version).toBe(2);
    expect((reportArtifact?.payloadJson as { executionVersion: number }).executionVersion).toBe(2);

    const remediationArtifact = calls.find((a) => a.type === "Remediation");
    expect(remediationArtifact).toBeDefined();
    expect(remediationArtifact?.version).toBe(1);

    const transcriptArtifact = calls.find((a) => a.type === "RemediationTranscript");
    expect(transcriptArtifact).toBeDefined();
  });

  it("bumps executionVersion to prevVersion + 1 even when the previous was higher than 1", async () => {
    const wellNumbered = makeRemediation({ executionVersion: 4 });
    const { agent, artifactRepo } = buildAgent(wellNumbered);

    await agent.run(makeReview(), makePrevReport({ executionVersion: 3 }), "/tmp/repo", "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
    }[];
    const reportArtifact = calls.find((a) => a.type === "ExecutionReport");
    expect(reportArtifact?.version).toBe(4);
  });

  it("overrides executionVersion server-side when the model returns the wrong value", async () => {
    // Model returns 99 but prev is 1, so server should override to 2.
    const wrongVersion = makeRemediation({ executionVersion: 99 });
    const { agent, artifactRepo, logger } = buildAgent(wrongVersion);

    const result = await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(result.executionReport.executionVersion).toBe(2);

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
    }[];
    const reportArtifact = calls.find((a) => a.type === "ExecutionReport");
    expect(reportArtifact?.version).toBe(2);
    expect((reportArtifact?.payloadJson as { executionVersion: number }).executionVersion).toBe(2);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        modelExecutionVersion: 99,
        expected: 2,
      }),
      expect.stringContaining("overriding server-side"),
    );
  });

  it("logs the score delta between the previous and new ExecutionReport", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makeReview(), makePrevReport({ score: 0.5 }), "/tmp/repo", "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.prevScore).toBe(0.5);
    expect(payload?.newScore).toBe(0.85);
    expect(payload?.scoreDelta).toBeCloseTo(0.35, 5);
  });

  it("returns the parsed remediation payload including the new executionReport", async () => {
    const { agent } = buildAgent();

    const result = await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(result.reviewId).toBe("rev-001");
    expect(result.readyForHumanReview).toBe(true);
    expect(result.resolution).toHaveLength(2);
    expect(result.executionReport.score).toBe(0.85);
    expect(result.executionReport.executionVersion).toBe(2);
  });
});
