import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function makeValidReport(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Implemented the feature",
    filesChanged: ["src/index.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks pass",
    ...overrides,
  };
}

describe("CheckResultSchema status normalization", () => {
  it("keeps a known status (pass/fail/skip) unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "boom" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" }).status).toBe("skip");
  });

  it("normalizes an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "warning", details: "unclear" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully-shaped report", () => {
    const result = ExecutionReportSchema.parse(makeValidReport());
    expect(result.executionVersion).toBe(1);
    expect(result.summary).toBe("Implemented the feature");
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(makeValidReport());
    expect(result.executionVersion).toBe(1);
  });

  it("keeps an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse(makeValidReport({ executionVersion: 3 }));
    expect(result.executionVersion).toBe(3);
  });

  it("normalizes an unrecognized check status nested inside a full report", () => {
    const result = ExecutionReportSchema.parse(
      makeValidReport({
        checks: {
          lint: { status: "warning", details: "unclear" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );
    expect(result.checks.lint.status).toBe("skip");
  });

  it("rejects a score outside [0, 1]", () => {
    expect(() => ExecutionReportSchema.parse(makeValidReport({ score: 1.5 }))).toThrow();
  });
});
