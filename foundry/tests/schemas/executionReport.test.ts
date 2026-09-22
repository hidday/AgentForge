import { describe, it, expect } from "vitest";
import {
  ExecutionReportSchema,
  CheckResultSchema,
  ChecksSchema,
} from "../../src/schemas/executionReport.js";

function validChecks() {
  return {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "fail", details: "1 failing" },
  };
}

function validReport() {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: validChecks(),
    notes: ["note 1"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation.",
  };
}

describe("CheckResultSchema", () => {
  it("passes through known statuses unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "x" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "x" }).status).toBe("skip");
  });

  it("normalizes an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "unknown-status", details: "weird" });
    expect(result.status).toBe("skip");
  });

  it("normalizes an empty status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "", details: "" });
    expect(result.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    expect(() => CheckResultSchema.parse({ status: 1, details: "x" })).toThrow();
  });
});

describe("ChecksSchema", () => {
  it("parses lint, typecheck, and tests results", () => {
    const result = ChecksSchema.parse(validChecks());
    expect(result.lint.status).toBe("pass");
    expect(result.tests.status).toBe("fail");
  });

  it("rejects when a required check group is missing", () => {
    const { tests: _tests, ...rest } = validChecks();
    expect(() => ChecksSchema.parse(rest)).toThrow();
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid report", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.score).toBe(0.8);
    expect(result.executionVersion).toBe(1);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const { executionVersion: _v, ...rest } = validReport();
    const result = ExecutionReportSchema.parse(rest);
    expect(result.executionVersion).toBe(1);
  });

  it("rejects a non-positive executionVersion", () => {
    expect(() => ExecutionReportSchema.parse({ ...validReport(), executionVersion: 0 })).toThrow();
  });

  it("rejects a non-integer executionVersion", () => {
    expect(() =>
      ExecutionReportSchema.parse({ ...validReport(), executionVersion: 1.5 }),
    ).toThrow();
  });

  it("rejects a score below 0", () => {
    expect(() => ExecutionReportSchema.parse({ ...validReport(), score: -0.1 })).toThrow();
  });

  it("rejects a score above 1", () => {
    expect(() => ExecutionReportSchema.parse({ ...validReport(), score: 1.1 })).toThrow();
  });

  it("accepts score at the boundaries 0 and 1", () => {
    expect(ExecutionReportSchema.parse({ ...validReport(), score: 0 }).score).toBe(0);
    expect(ExecutionReportSchema.parse({ ...validReport(), score: 1 }).score).toBe(1);
  });

  it("rejects a non-boolean prDraftCreated", () => {
    expect(() =>
      ExecutionReportSchema.parse({ ...validReport(), prDraftCreated: "yes" }),
    ).toThrow();
  });

  it("rejects when checks is malformed", () => {
    expect(() =>
      ExecutionReportSchema.parse({ ...validReport(), checks: { lint: {} } }),
    ).toThrow();
  });

  it("rejects when filesChanged is not an array", () => {
    expect(() =>
      ExecutionReportSchema.parse({ ...validReport(), filesChanged: "src/foo.ts" }),
    ).toThrow();
  });
});
