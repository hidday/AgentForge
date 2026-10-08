import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

function report(overrides: Record<string, unknown> = {}) {
  return {
    summary: "s",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "fail", details: "x" },
      tests: { status: "skip", details: "" },
    },
    notes: [],
    prDraftCreated: false,
    score: 0.5,
    scoreRationale: "r",
    ...overrides,
  };
}

describe("CheckResultSchema", () => {
  it.each(["pass", "fail", "skip"])("keeps the known status %j", (s) => {
    expect(CheckResultSchema.parse({ status: s, details: "" }).status).toBe(s);
  });

  it.each(["passed", "error", "", "PASS"])("coerces unknown status %j to 'skip'", (s) => {
    expect(CheckResultSchema.parse({ status: s, details: "d" })).toEqual({
      status: "skip",
      details: "d",
    });
  });

  it("rejects a missing details field", () => {
    expect(CheckResultSchema.safeParse({ status: "pass" }).success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when absent", () => {
    expect(ExecutionReportSchema.parse(report()).executionVersion).toBe(1);
  });

  it("keeps an explicit executionVersion", () => {
    expect(ExecutionReportSchema.parse(report({ executionVersion: 4 })).executionVersion).toBe(4);
  });

  it.each([
    ["score above 1", { score: 1.5 }],
    ["negative score", { score: -0.01 }],
    ["zero executionVersion", { executionVersion: 0 }],
    ["non-string file", { filesChanged: [1] }],
  ])("rejects %s", (_l, overrides) => {
    expect(ExecutionReportSchema.safeParse(report(overrides)).success).toBe(false);
  });
});
