import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

describe("CheckResultSchema", () => {
  it("keeps a known status value (e.g. pass) unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" })).toEqual({
      status: "pass",
      details: "ok",
    });
  });

  it("keeps other known statuses (fail, skip) unchanged", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "d" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "d" }).status).toBe("skip");
  });

  it("normalizes an unknown status value to skip", () => {
    expect(CheckResultSchema.parse({ status: "unknown-thing", details: "weird" })).toEqual({
      status: "skip",
      details: "weird",
    });
  });
});

describe("ChecksSchema", () => {
  it("parses a full valid checks object", () => {
    const checks = {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    };
    expect(ChecksSchema.parse(checks)).toEqual(checks);
  });

  it("fails when a required check is missing", () => {
    const result = ChecksSchema.safeParse({
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  const validReport = {
    executionVersion: 1,
    summary: "did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: ["note1"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "solid",
  };

  it("parses a valid execution report", () => {
    expect(ExecutionReportSchema.parse(validReport)).toEqual(validReport);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion: _omit, ...rest } = validReport;
    const parsed = ExecutionReportSchema.parse(rest);
    expect(parsed.executionVersion).toBe(1);
  });

  it("fails when score is out of the 0-1 range", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport, score: 1.5 });
    expect(result.success).toBe(false);
  });

  it("fails when prDraftCreated is not a boolean", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport, prDraftCreated: "yes" });
    expect(result.success).toBe(false);
  });
});
