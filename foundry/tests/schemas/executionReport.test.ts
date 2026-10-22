import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it.each([
    ["pass", "pass"],
    ["fail", "fail"],
    ["skip", "skip"],
    ["unknown-status", "skip"],
    ["", "skip"],
  ])("normalizes %s to %s", (input, expected) => {
    const result = CheckResultSchema.parse({ status: input, details: "details" });
    expect(result.status).toBe(expected);
  });
});

describe("ExecutionReportSchema", () => {
  function baseReport(overrides: Record<string, unknown> = {}) {
    return {
      summary: "Implemented the feature.",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Solid work.",
      ...overrides,
    };
  }

  it("defaults executionVersion to 1 when absent", () => {
    const result = ExecutionReportSchema.parse(baseReport());
    expect(result.executionVersion).toBe(1);
  });

  it("preserves an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse(baseReport({ executionVersion: 3 }));
    expect(result.executionVersion).toBe(3);
  });

  it("rejects a score outside [0, 1]", () => {
    expect(() => ExecutionReportSchema.parse(baseReport({ score: 1.1 }))).toThrow();
  });

  it("rejects a non-positive executionVersion", () => {
    expect(() => ExecutionReportSchema.parse(baseReport({ executionVersion: 0 }))).toThrow();
  });

  it("normalizes an unrecognized check status to 'skip' within a full report", () => {
    const result = ExecutionReportSchema.parse(
      baseReport({
        checks: {
          lint: { status: "weird", details: "?" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );
    expect(result.checks.lint.status).toBe("skip");
  });

  it("rejects a report missing a required field", () => {
    const report = baseReport() as Record<string, unknown>;
    delete report.summary;
    expect(() => ExecutionReportSchema.parse(report)).toThrow();
  });
});
