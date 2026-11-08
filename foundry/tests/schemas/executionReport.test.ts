import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("passes known status '%s' through unchanged", (status) => {
    const result = CheckResultSchema.parse({ status, details: "" });
    expect(result.status).toBe(status);
  });

  it("normalizes an unknown status value to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "unexpected" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const report = ExecutionReportSchema.parse({
      summary: "Did the thing",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.5,
      scoreRationale: "fine",
    });
    expect(report.executionVersion).toBe(1);
  });

  it("normalizes an unrecognized check status to 'skip' within the full report", () => {
    const report = ExecutionReportSchema.parse({
      executionVersion: 1,
      summary: "Did the thing",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "not-a-real-status", details: "weird CI output" },
        tests: { status: "pass", details: "" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.5,
      scoreRationale: "fine",
    });
    expect(report.checks.typecheck.status).toBe("skip");
  });
});
