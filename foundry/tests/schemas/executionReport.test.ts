import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

describe("CheckResultSchema", () => {
  it("passes through each known status unchanged (pass/fail/skip)", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" })).toEqual({
      status: "pass",
      details: "ok",
    });
    expect(CheckResultSchema.parse({ status: "fail", details: "broke" })).toEqual({
      status: "fail",
      details: "broke",
    });
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" })).toEqual({
      status: "skip",
      details: "n/a",
    });
  });

  it("coerces an unknown status string to 'skip' via the transform's fallback branch", () => {
    const result = CheckResultSchema.parse({ status: "unknown-status", details: "weird" });
    expect(result.status).toBe("skip");
    expect(result.details).toBe("weird");
  });

  it("fails when details is missing", () => {
    const result = CheckResultSchema.safeParse({ status: "pass" });
    expect(result.success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("parses valid lint/typecheck/tests check results", () => {
    const valid = {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "2 failing" },
    };
    const result = ChecksSchema.parse(valid);
    expect(result.tests.status).toBe("fail");
  });
});

describe("ExecutionReportSchema", () => {
  const baseChecks = {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "pass", details: "ok" },
  };

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion, ...rest } = {
      executionVersion: 1,
      summary: "Did the thing",
      filesChanged: ["a.ts"],
      checks: baseChecks,
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Looks solid",
    };
    void executionVersion;

    const result = ExecutionReportSchema.parse(rest);
    expect(result.executionVersion).toBe(1);
  });

  it("preserves an explicitly provided executionVersion rather than defaulting it", () => {
    const result = ExecutionReportSchema.parse({
      executionVersion: 3,
      summary: "Did the thing",
      filesChanged: ["a.ts"],
      checks: baseChecks,
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Looks solid",
    });
    expect(result.executionVersion).toBe(3);
  });

  it("fails when executionVersion is provided but not a positive integer", () => {
    const result = ExecutionReportSchema.safeParse({
      executionVersion: 0,
      summary: "x",
      filesChanged: [],
      checks: baseChecks,
      notes: [],
      prDraftCreated: false,
      score: 0.5,
      scoreRationale: "x",
    });
    expect(result.success).toBe(false);
  });

  it("fails when score is outside the 0-1 range", () => {
    const result = ExecutionReportSchema.safeParse({
      summary: "x",
      filesChanged: [],
      checks: baseChecks,
      notes: [],
      prDraftCreated: false,
      score: 1.5,
      scoreRationale: "x",
    });
    expect(result.success).toBe(false);
  });

  it("accepts score at the boundaries 0 and 1", () => {
    const make = (score: number) => ({
      summary: "x",
      filesChanged: [],
      checks: baseChecks,
      notes: [],
      prDraftCreated: false,
      score,
      scoreRationale: "x",
    });
    expect(ExecutionReportSchema.safeParse(make(0)).success).toBe(true);
    expect(ExecutionReportSchema.safeParse(make(1)).success).toBe(true);
  });
});
