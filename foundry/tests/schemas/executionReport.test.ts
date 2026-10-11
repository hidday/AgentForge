import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

const validChecks = {
  lint: { status: "pass", details: "ok" },
  typecheck: { status: "pass", details: "ok" },
  tests: { status: "pass", details: "ok" },
};

const validReport = {
  summary: "Did the thing",
  filesChanged: ["src/a.ts"],
  checks: validChecks,
  notes: [],
  prDraftCreated: true,
  score: 0.5,
  scoreRationale: "Reasonable",
};

describe("CheckResultSchema.status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("passes a known status %s through unchanged", (status) => {
    const result = CheckResultSchema.safeParse({ status, details: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe(status);
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.safeParse({ status: "error", details: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    const result = CheckResultSchema.safeParse({ status: 1, details: "x" });
    expect(result.success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("accepts all three known checks", () => {
    const result = ChecksSchema.safeParse(validChecks);
    expect(result.success).toBe(true);
  });

  it("rejects when a check is missing", () => {
    const { tests: _tests, ...rest } = validChecks;
    const result = ChecksSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("accepts a fully valid report and defaults executionVersion to 1", () => {
    const result = ExecutionReportSchema.safeParse(validReport);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport, executionVersion: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.executionVersion).toBe(3);
  });

  it("rejects a non-positive executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport, executionVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts score at the boundaries 0 and 1", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport, score: 0 }).success).toBe(true);
    expect(ExecutionReportSchema.safeParse({ ...validReport, score: 1 }).success).toBe(true);
  });

  it("rejects score outside [0, 1]", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport, score: -0.1 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport, score: 1.1 }).success).toBe(false);
  });

  it("rejects a report missing filesChanged", () => {
    const { filesChanged: _filesChanged, ...rest } = validReport;
    const result = ExecutionReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a report where filesChanged is not an array of strings", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport, filesChanged: "not-array" });
    expect(result.success).toBe(false);
  });
});
