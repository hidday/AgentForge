import { describe, it, expect } from "vitest";
import { CheckResultSchema, ChecksSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validChecks() {
  return {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "pass", details: "ok" },
  };
}

function validReport() {
  return {
    summary: "Implemented login",
    filesChanged: ["src/login.ts"],
    checks: validChecks(),
    notes: ["Looks good"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks pass",
  };
}

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("keeps known status %s as-is", (status) => {
    const result = CheckResultSchema.parse({ status, details: "d" });
    expect(result.status).toBe(status);
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "unknown-status", details: "d" });
    expect(result.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    const result = CheckResultSchema.safeParse({ status: 1, details: "d" });
    expect(result.success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("requires lint, typecheck and tests", () => {
    expect(ChecksSchema.safeParse(validChecks()).success).toBe(true);
    const { lint, ...missingLint } = validChecks();
    expect(lint).toBeDefined();
    expect(ChecksSchema.safeParse(missingLint).success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid report", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.summary).toBe("Implemented login");
    expect(result.checks.lint.status).toBe("pass");
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
  });

  it("keeps a provided executionVersion", () => {
    const result = ExecutionReportSchema.parse({ ...validReport(), executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
  });

  it("rejects score outside [0, 1]", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.5 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: -0.5 }).success).toBe(false);
  });

  it("accepts score at the boundaries 0 and 1", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 0 }).success).toBe(true);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1 }).success).toBe(true);
  });

  it("rejects a report missing required fields", () => {
    const report = validReport();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (report as any).checks;
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects filesChanged that is not an array", () => {
    expect(
      ExecutionReportSchema.safeParse({ ...validReport(), filesChanged: "not-array" }).success,
    ).toBe(false);
  });
});
