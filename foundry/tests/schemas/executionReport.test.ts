import { describe, it, expect } from "vitest";
import { CheckResultSchema, ChecksSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validChecks() {
  return {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "fail", details: "1 failing" },
  };
}

function validReport() {
  return {
    summary: "Did the thing",
    filesChanged: ["src/foo.ts"],
    checks: validChecks(),
    notes: [],
    prDraftCreated: true,
    score: 0.5,
    scoreRationale: "Half done",
  };
}

describe("CheckResultSchema", () => {
  it("passes through a known status unchanged", () => {
    const result = CheckResultSchema.safeParse({ status: "pass", details: "ok" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("pass");
  });

  it("normalizes an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.safeParse({ status: "unknown-thing", details: "n/a" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("skip");
  });

  it("accepts all three known statuses", () => {
    for (const status of ["pass", "fail", "skip"]) {
      const result = CheckResultSchema.safeParse({ status, details: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe(status);
    }
  });
});

describe("ChecksSchema", () => {
  it("requires lint, typecheck and tests", () => {
    expect(ChecksSchema.safeParse(validChecks()).success).toBe(true);
    const { lint: _lint, ...rest } = validChecks();
    expect(ChecksSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.safeParse(validReport());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(3);
  });

  it("rejects a score above 1 or below 0", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.5 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: -0.1 }).success).toBe(false);
  });

  it("accepts score at the boundaries 0 and 1", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 0 }).success).toBe(true);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1 }).success).toBe(true);
  });

  it("rejects a non-boolean prDraftCreated", () => {
    const result = ExecutionReportSchema.safeParse({
      ...validReport(),
      prDraftCreated: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when checks is missing", () => {
    const { checks: _checks, ...rest } = validReport();
    expect(ExecutionReportSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts an empty filesChanged and notes array", () => {
    const result = ExecutionReportSchema.safeParse({
      ...validReport(),
      filesChanged: [],
      notes: [],
    });
    expect(result.success).toBe(true);
  });
});
