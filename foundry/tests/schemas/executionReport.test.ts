import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

function validChecks() {
  return {
    lint: { status: "pass", details: "clean" },
    typecheck: { status: "pass", details: "clean" },
    tests: { status: "pass", details: "clean" },
  };
}

function validReport() {
  return {
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: validChecks(),
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid work.",
  };
}

describe("CheckResultSchema", () => {
  it("passes through a known status unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "" })).toEqual({
      status: "pass",
      details: "",
    });
    expect(CheckResultSchema.parse({ status: "fail", details: "" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "" }).status).toBe("skip");
  });

  it("normalizes an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "unknown-weird-status", details: "x" });
    expect(result.status).toBe("skip");
  });
});

describe("ChecksSchema", () => {
  it("parses a valid checks object", () => {
    const result = ChecksSchema.parse(validChecks());
    expect(result.lint.status).toBe("pass");
    expect(result.typecheck.status).toBe("pass");
    expect(result.tests.status).toBe("pass");
  });

  it("rejects a checks object missing a required key", () => {
    const { tests, ...rest } = validChecks();
    const result = ChecksSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a valid report and defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
    expect(result.summary).toBe("Implemented the feature.");
  });

  it("uses the provided executionVersion when present", () => {
    const input = { ...validReport(), executionVersion: 3 };
    const result = ExecutionReportSchema.parse(input);
    expect(result.executionVersion).toBe(3);
  });

  it("rejects executionVersion of zero (must be positive)", () => {
    const input = { ...validReport(), executionVersion: 0 };
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer executionVersion", () => {
    const input = { ...validReport(), executionVersion: 1.5 };
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects score below the minimum boundary", () => {
    const input = { ...validReport(), score: -0.01 };
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects score above the maximum boundary", () => {
    const input = { ...validReport(), score: 1.01 };
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts score at the 0 and 1 boundaries", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 0 }).success).toBe(true);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1 }).success).toBe(true);
  });

  it("rejects wrong type for filesChanged", () => {
    const input = { ...validReport(), filesChanged: "not-an-array" };
    const result = ExecutionReportSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a report missing the required checks field", () => {
    const { checks, ...rest } = validReport();
    const result = ExecutionReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
