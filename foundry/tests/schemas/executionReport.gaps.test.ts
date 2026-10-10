import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function validCheck(status: string) {
  return { status, details: "details" };
}

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Summary",
    filesChanged: [],
    checks: {
      lint: validCheck("pass"),
      typecheck: validCheck("pass"),
      tests: validCheck("pass"),
    },
    notes: [],
    prDraftCreated: true,
    score: 0.5,
    scoreRationale: "rationale",
    ...overrides,
  };
}

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"])("passes known status %s through unchanged", (status) => {
    const result = CheckResultSchema.safeParse(validCheck(status));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe(status);
  });

  it("maps an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.safeParse(validCheck("unknown_status"));
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

  it("normalizes an unknown check status to 'skip' within the nested checks object", () => {
    const result = ExecutionReportSchema.safeParse(
      validReport({ checks: { ...validReport().checks, lint: validCheck("weird") } }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.checks.lint.status).toBe("skip");
  });

  it("respects an explicit executionVersion override", () => {
    const result = ExecutionReportSchema.safeParse(validReport({ executionVersion: 3 }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(3);
  });

  it("rejects a score outside the 0-1 bounds", () => {
    expect(ExecutionReportSchema.safeParse(validReport({ score: 1.2 })).success).toBe(false);
  });

  it("rejects a report missing the required checks object", () => {
    const { checks, ...rest } = validReport();
    expect(checks).toBeDefined();
    expect(ExecutionReportSchema.safeParse(rest).success).toBe(false);
  });
});
