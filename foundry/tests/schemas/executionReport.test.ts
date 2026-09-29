import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it("keeps a known status ('pass') as-is", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
  });

  it("keeps 'fail' as-is", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "broke" }).status).toBe("fail");
  });

  it("keeps 'skip' as-is", () => {
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" }).status).toBe("skip");
  });

  it("normalizes an unrecognized status to 'skip'", () => {
    expect(CheckResultSchema.parse({ status: "unknown-status", details: "?" }).status).toBe(
      "skip",
    );
  });
});

describe("ChecksSchema", () => {
  it("parses a full set of checks", () => {
    const checks = {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    };
    const result = ChecksSchema.parse(checks);
    expect(result.tests.status).toBe("fail");
  });

  it("rejects a missing check", () => {
    const checks = {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
    };
    expect(ChecksSchema.safeParse(checks).success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  const validReport = {
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: ["Nothing unusual"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks passed",
  };

  it("parses a valid report and defaults executionVersion to 1", () => {
    const result = ExecutionReportSchema.parse(validReport);
    expect(result.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse({ ...validReport, executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
  });

  it("rejects a score outside [0, 1]", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport, score: 1.2 }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { summary: _summary, ...missing } = validReport;
    expect(ExecutionReportSchema.safeParse(missing).success).toBe(false);
  });

  it("normalizes an unknown check status nested inside a full report", () => {
    const report = {
      ...validReport,
      checks: { ...validReport.checks, tests: { status: "weird", details: "?" } },
    };
    const result = ExecutionReportSchema.parse(report);
    expect(result.checks.tests.status).toBe("skip");
  });
});
