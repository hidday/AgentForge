import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validReport() {
  return {
    summary: "Did the work",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid work",
  };
}

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"])("passes a known status (%s) through unchanged", (status) => {
    const result = CheckResultSchema.parse({ status, details: "ok" });
    expect(result.status).toBe(status);
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "error", details: "unexpected" });
    expect(result.status).toBe("skip");
  });

  it("normalizes an empty status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "", details: "" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid report and defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
    expect(result.score).toBe(0.9);
  });

  it("normalizes an unknown check status to 'skip' within the full report", () => {
    const report = validReport();
    report.checks.tests.status = "weird-status";
    const result = ExecutionReportSchema.parse(report);
    expect(result.checks.tests.status).toBe("skip");
  });

  it("rejects a score outside the 0-1 range", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), score: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { summary: _summary, ...rest } = validReport();
    const result = ExecutionReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when filesChanged has the wrong type", () => {
    const result = ExecutionReportSchema.safeParse({
      ...validReport(),
      filesChanged: "not-an-array",
    });
    expect(result.success).toBe(false);
  });
});
