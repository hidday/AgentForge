import { describe, it, expect } from "vitest";
import {
  ExecutionReportSchema,
  CheckResultSchema,
  ChecksSchema,
} from "../../src/schemas/executionReport.js";

function validReport() {
  return {
    executionVersion: 1,
    summary: "Did the thing.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
  };
}

describe("CheckResultSchema", () => {
  it("passes through a known status value (pass)", () => {
    const result = CheckResultSchema.parse({ status: "pass", details: "ok" });
    expect(result.status).toBe("pass");
  });

  it("passes through known status values fail and skip", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "x" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "x" }).status).toBe("skip");
  });

  it("normalizes an unknown/garbage status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "unknown-status", details: "weird" });
    expect(result.status).toBe("skip");
  });

  it("normalizes an empty string status to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "", details: "" });
    expect(result.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    const result = CheckResultSchema.safeParse({ status: 1, details: "x" });
    expect(result.success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("accepts all three check results", () => {
    const result = ChecksSchema.safeParse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "fail", details: "errors" },
      tests: { status: "skip", details: "n/a" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a required check is missing", () => {
    const result = ChecksSchema.safeParse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("accepts a fully valid execution report", () => {
    const result = ExecutionReportSchema.safeParse(validReport());
    expect(result.success).toBe(true);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion, ...rest } = validReport();
    const parsed = ExecutionReportSchema.parse(rest);
    expect(parsed.executionVersion).toBe(1);
  });

  it("rejects a non-positive executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a score above 1 or below 0", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.1 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: -0.1 }).success).toBe(
      false,
    );
  });

  it("accepts boundary scores of 0 and 1", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 0 }).success).toBe(true);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1 }).success).toBe(true);
  });

  it("normalizes an unrecognized check status nested within the report to 'skip'", () => {
    const report = validReport();
    report.checks.tests.status = "weird-status";
    const parsed = ExecutionReportSchema.parse(report);
    expect(parsed.checks.tests.status).toBe("skip");
  });

  it("rejects when prDraftCreated is not a boolean", () => {
    const result = ExecutionReportSchema.safeParse({
      ...validReport(),
      prDraftCreated: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when filesChanged is not an array of strings", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), filesChanged: "foo.ts" });
    expect(result.success).toBe(false);
  });
});
