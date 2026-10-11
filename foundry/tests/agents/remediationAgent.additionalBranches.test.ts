import { describe, it, expect, vi } from "vitest";
import { RemediationAgent } from "../../src/agents/remediationAgent.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeReview(): Review {
  return {
    reviewId: "rev-001",
    summary: "Found several issues.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
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
      {
        id: "f3",
        severity: "important",
        type: "bug",
        file: "src/bar.ts",
        title: "Partial fix candidate",
        details: "Only half addressed",
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
    score: 0.7,
    scoreRationale: "One test still failing.",
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
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "Bug fixed, tests now green.",
    ...newReport,
  };
  return {
    reviewId: "rev-001",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Added null guard", rationale: "Real bug" },
      { findingId: "f2", status: "rejected", action: "No changes made", rationale: "Style" },
      {
        findingId: "f3",
        status: "partially_addressed",
        action: "Partially fixed",
        rationale: "Needs more work",
      },
    ],
    readyForHumanReview: true,
    executionReport: report,
    ...overrides,
  };
}

function buildAgent(remediationOverride?: Remediation) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw remediation transcript",
      parsed: {
        stage: "remediation" as const,
        payload: remediationOverride ?? makeRemediation(),
      },
    }),
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

  const agent = new RemediationAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, artifactRepo, logger };
}

describe("RemediationAgent.run() additional boundary cases", () => {
  it("counts accepted, rejected, and partially_addressed resolutions exactly", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.accepted).toBe(1);
    expect(payload.rejected).toBe(1);
    expect(payload.partial).toBe(1);
  });

  it("logs a negative scoreDelta when the new score regresses below the previous score", async () => {
    const regressed = makeRemediation({ score: 0.4 });
    const { agent, logger } = buildAgent(regressed);

    await agent.run(makeReview(), makePrevReport({ score: 0.7 }), "/tmp/repo", "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.prevScore).toBe(0.7);
    expect(payload.newScore).toBe(0.4);
    expect(payload.scoreDelta).toBeCloseTo(-0.3, 5);
  });

  it("does not warn when the model returns zero resolutions but still writes artifacts", async () => {
    const noResolutions = makeRemediation(undefined, { resolution: [] });
    const { agent, artifactRepo, logger } = buildAgent(noResolutions);

    const result = await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(result.resolution).toHaveLength(0);
    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.accepted).toBe(0);
    expect(payload.rejected).toBe(0);
    expect(payload.partial).toBe(0);

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as { type: string }[];
    expect(calls.map((c) => c.type)).toEqual(
      expect.arrayContaining(["RemediationTranscript", "ExecutionReport", "Remediation"]),
    );
  });

  it("does not emit the server-side override warning when the model's executionVersion already matches", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
