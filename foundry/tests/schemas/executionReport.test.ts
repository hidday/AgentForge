import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function validCheck(status = "pass") {
  return { status, details: "ok" };
}

function validReport() {
  return {
    summary: "Implemented the feature",
    filesChanged: ["src/index.ts"],
    checks: {
      lint: validCheck("pass"),
      typecheck: validCheck("pass"),
      tests: validCheck("fail"),
    },
    notes: ["note 1"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Mostly correct",
  };
}

describe("CheckResultSchema status normalization", () => {
  it("passes through each known status unchanged", () => {
    for (const status of ["pass", "fail", "skip"]) {
      const result = CheckResultSchema.safeParse(validCheck(status));
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe(status);
    }
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    const result = CheckResultSchema.safeParse(validCheck("unknown"));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("accepts a fully valid report and defaults executionVersion to 1", () => {
    const result = ExecutionReportSchema.safeParse(validReport());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(3);
  });

  it("normalizes an unrecognized check status to 'skip' within the full report", () => {
    const result = ExecutionReportSchema.safeParse({
      ...validReport(),
      checks: {
        lint: validCheck("weird-status"),
        typecheck: validCheck("pass"),
        tests: validCheck("pass"),
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.checks.lint.status).toBe("skip");
  });

  it("rejects score above 1", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.1 }).success).toBe(false);
  });

  it("rejects when a check is missing", () => {
    const { checks, ...rest } = validReport();
    const { tests, ...partialChecks } = checks;
    expect(ExecutionReportSchema.safeParse({ ...rest, checks: partialChecks }).success).toBe(
      false,
    );
  });
});
