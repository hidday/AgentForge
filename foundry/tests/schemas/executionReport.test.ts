import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
    ...overrides,
  };
}

describe("CheckResultSchema", () => {
  it("passes through a known status unchanged", () => {
    const result = CheckResultSchema.parse({ status: "pass", details: "ok" });
    expect(result.status).toBe("pass");
  });

  it("passes through each other known status unchanged", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "" }).status).toBe("skip");
  });

  it("normalizes an unknown status to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "unexpected" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid execution report", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.summary).toBe("Did the thing");
    expect(result.checks.lint.status).toBe("pass");
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const report = validReport();
    delete (report as Record<string, unknown>).executionVersion;
    const result = ExecutionReportSchema.parse(report);
    expect(result.executionVersion).toBe(1);
  });

  it("rejects a score outside the 0-1 range", () => {
    expect(() => ExecutionReportSchema.parse(validReport({ score: 1.5 }))).toThrow();
  });

  it("normalizes an unrecognized check status inside a full report to 'skip'", () => {
    const report = validReport({
      checks: {
        lint: { status: "weird", details: "?" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    const result = ExecutionReportSchema.parse(report);
    expect(result.checks.lint.status).toBe("skip");
  });
});
