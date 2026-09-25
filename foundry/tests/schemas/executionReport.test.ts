import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function makeValidExecutionReport() {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Looks solid.",
  };
}

describe("CheckResultSchema status normalization", () => {
  it("passes through a status that is one of the known statuses unchanged", () => {
    const result = CheckResultSchema.safeParse({ status: "fail", details: "2 tests failed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("fail");
    }
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.safeParse({ status: "flaky", details: "unclear" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("skip");
    }
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully well-formed execution report", () => {
    const input = makeValidExecutionReport();
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checks.lint.status).toBe("pass");
      expect(result.data.score).toBe(0.8);
    }
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion: _v, ...rest } = makeValidExecutionReport();
    const result = ExecutionReportSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionVersion).toBe(1);
    }
  });

  it("normalizes an unrecognized check status embedded within the full report", () => {
    const input = makeValidExecutionReport();
    input.checks.tests.status = "unknown-status";
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checks.tests.status).toBe("skip");
    }
  });

  it("fails when score is out of the 0-1 range", () => {
    const input = makeValidExecutionReport();
    input.score = 1.5;
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
