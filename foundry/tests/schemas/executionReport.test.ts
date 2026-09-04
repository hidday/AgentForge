import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validReport() {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid implementation.",
  };
}

describe("CheckResultSchema", () => {
  it("passes through a known status unchanged", () => {
    const result = CheckResultSchema.safeParse({ status: "pass", details: "ok" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("pass");
  });

  it("passes through 'fail' and 'skip' as-is", () => {
    expect(CheckResultSchema.safeParse({ status: "fail", details: "x" }).success).toBe(true);
    expect(CheckResultSchema.safeParse({ status: "skip", details: "x" }).success).toBe(true);
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.safeParse({ status: "unknown-status", details: "weird" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid execution report", () => {
    const result = ExecutionReportSchema.safeParse(validReport());
    expect(result.success).toBe(true);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion: _v, ...withoutVersion } = validReport();
    const result = ExecutionReportSchema.safeParse(withoutVersion);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(1);
  });

  it("rejects a score outside the 0-1 range", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.5 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: -0.1 }).success).toBe(false);
  });

  it("rejects a non-positive executionVersion", () => {
    expect(
      ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 0 }).success,
    ).toBe(false);
  });

  it("normalizes an invalid check status nested inside the full report", () => {
    const report = validReport();
    report.checks.tests.status = "flaky";
    const result = ExecutionReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.checks.tests.status).toBe("skip");
  });

  it("rejects a report missing a required field", () => {
    const { summary: _s, ...withoutSummary } = validReport();
    expect(ExecutionReportSchema.safeParse(withoutSummary).success).toBe(false);
  });
});
