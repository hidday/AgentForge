import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("passes through known status '%s' unchanged", (status) => {
    const result = CheckResultSchema.parse({ status, details: "" });
    expect(result.status).toBe(status);
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "crashed" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const report = ExecutionReportSchema.parse({
      summary: "Did the work",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.8,
      scoreRationale: "Solid",
    });
    expect(report.executionVersion).toBe(1);
  });

  it("rejects a score outside [0, 1]", () => {
    expect(() =>
      ExecutionReportSchema.parse({
        executionVersion: 1,
        summary: "x",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
        notes: [],
        prDraftCreated: false,
        score: 1.2,
        scoreRationale: "x",
      }),
    ).toThrow();
  });
});
