import { describe, it, expect } from "vitest";
import { CheckResultSchema, ChecksSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it("passes through a known status ('pass')", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
  });

  it("passes through the other known statuses ('fail', 'skip')", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "d" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "d" }).status).toBe("skip");
  });

  it("maps an unrecognized status string to 'skip'", () => {
    expect(CheckResultSchema.parse({ status: "errored", details: "d" }).status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    expect(() => CheckResultSchema.parse({ status: 1, details: "d" })).toThrow();
  });

  it("rejects when details is missing", () => {
    expect(() => CheckResultSchema.parse({ status: "pass" })).toThrow();
  });
});

describe("ChecksSchema", () => {
  const validChecks = {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "fail", details: "1 test failed" },
  };

  it("parses all three required check results", () => {
    const result = ChecksSchema.parse(validChecks);
    expect(result.tests.status).toBe("fail");
  });

  it("rejects when a required check (tests) is missing", () => {
    const { tests, ...rest } = validChecks;
    expect(() => ChecksSchema.parse(rest)).toThrow();
  });
});

describe("ExecutionReportSchema", () => {
  const validReport = {
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: ["note one"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "solid implementation",
  };

  it("parses a well-formed report", () => {
    const result = ExecutionReportSchema.parse(validReport);
    expect(result.score).toBe(0.75);
    expect(result.executionVersion).toBe(1);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport);
    expect(result.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse({ ...validReport, executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
  });

  it("rejects score above 1", () => {
    expect(() => ExecutionReportSchema.parse({ ...validReport, score: 1.01 })).toThrow();
  });

  it("rejects score below 0", () => {
    expect(() => ExecutionReportSchema.parse({ ...validReport, score: -0.01 })).toThrow();
  });

  it("accepts boundary score values 0 and 1", () => {
    expect(ExecutionReportSchema.parse({ ...validReport, score: 0 }).score).toBe(0);
    expect(ExecutionReportSchema.parse({ ...validReport, score: 1 }).score).toBe(1);
  });

  it("rejects when prDraftCreated is not a boolean", () => {
    expect(() =>
      ExecutionReportSchema.parse({ ...validReport, prDraftCreated: "true" }),
    ).toThrow();
  });

  it("rejects when filesChanged is missing", () => {
    const { filesChanged, ...rest } = validReport;
    expect(() => ExecutionReportSchema.parse(rest)).toThrow();
  });

  it("propagates a check status normalization inside a full report", () => {
    const result = ExecutionReportSchema.parse({
      ...validReport,
      checks: {
        ...validReport.checks,
        tests: { status: "unknown-status", details: "flaky" },
      },
    });
    expect(result.checks.tests.status).toBe("skip");
  });
});
