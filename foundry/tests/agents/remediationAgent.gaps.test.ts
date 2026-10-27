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
    notes: ["Partially fixed f1"],
    prDraftCreated: true,
    score: 0.7,
    scoreRationale: "Partial progress.",
    ...newReport,
  };
  return {
    reviewId: "rev-001",
    resolution: [
      {
        findingId: "f1",
        status: "partially_addressed",
        action: "Added a guard in the obvious path, edge case remains",
        rationale: "Full fix requires a larger refactor out of scope here",
      },
    ],
    readyForHumanReview: false,
    executionReport: report,
    ...overrides,
  };
}

function buildAgent(remediationOverride?: Remediation) {
  const agentRunner = {
    run: vi.fn().mockImplementation(async () => ({
      raw: "raw remediation transcript",
      parsed: {
        stage: "remediation" as const,
        payload: remediationOverride ?? makeRemediation(),
      },
    })),
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

  return { agent, agentRunner, artifactRepo, logger };
}

describe("RemediationAgent.run() additional branch coverage", () => {
  it("logs a partial count when a resolution is partially_addressed, and no accepted/rejected", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.accepted).toBe(0);
    expect(payload?.rejected).toBe(0);
    expect(payload?.partial).toBe(1);
    expect(payload?.readyForHumanReview).toBe(false);
  });

  it("does not warn when the model's executionVersion already matches the expected next version", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns readyForHumanReview=false and the partially_addressed resolution untouched", async () => {
    const { agent } = buildAgent();

    const result = await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    expect(result.readyForHumanReview).toBe(false);
    expect(result.resolution).toHaveLength(1);
    expect(result.resolution[0].status).toBe("partially_addressed");
  });

  it("counts accepted, rejected, and partial together when resolution has a mix of all three", async () => {
    const mixed = makeRemediation(
      {},
      {
        resolution: [
          {
            findingId: "f1",
            status: "accepted",
            action: "Fixed",
            rationale: "Real bug",
          },
          {
            findingId: "f2",
            status: "rejected",
            action: "No change",
            rationale: "Not a real issue",
          },
          {
            findingId: "f3",
            status: "partially_addressed",
            action: "Partial fix",
            rationale: "Needs follow-up",
          },
        ],
      },
    );
    const { agent, logger } = buildAgent(mixed);

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Remediation completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.accepted).toBe(1);
    expect(payload?.rejected).toBe(1);
    expect(payload?.partial).toBe(1);
  });

  it("persists the Remediation artifact's rawText as pretty-printed JSON of the full payload", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makeReview(), makePrevReport(), "/tmp/repo", "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      rawText: string;
    }[];
    const remediationArtifact = calls.find((a) => a.type === "Remediation");
    expect(remediationArtifact).toBeDefined();
    const parsedBack = JSON.parse(remediationArtifact!.rawText) as Remediation;
    expect(parsedBack.reviewId).toBe("rev-001");
    expect(parsedBack.readyForHumanReview).toBe(false);
  });
});
