import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function validReport() {
  return {
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "clean",
  };
}

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"])("passes through a known status '%s' unchanged", (status) => {
    const result = CheckResultSchema.parse({ status, details: "" });
    expect(result.status).toBe(status);
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "not-run", details: "" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse({ ...validReport(), executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
  });

  it("normalizes an unrecognized check status inside the nested checks object", () => {
    const result = ExecutionReportSchema.parse({
      ...validReport(),
      checks: {
        lint: { status: "unknown-status", details: "weird" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
    });
    expect(result.checks.lint.status).toBe("skip");
  });

  it("rejects a score outside the 0-1 range", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.1 }).success).toBe(false);
  });

  it("rejects a report missing required fields", () => {
    const { summary: _s, ...rest } = validReport();
    expect(ExecutionReportSchema.safeParse(rest).success).toBe(false);
  });
});
