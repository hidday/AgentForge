import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it("passes through each known status unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "boom" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "" }).status).toBe("skip");
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "unexpected" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const report = ExecutionReportSchema.parse({
      summary: "Did the thing.",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "unknown-status", details: "" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.9,
      scoreRationale: "Solid.",
    });

    expect(report.executionVersion).toBe(1);
    // An unrecognized incoming test status normalizes to "skip".
    expect(report.checks.tests.status).toBe("skip");
  });
});
