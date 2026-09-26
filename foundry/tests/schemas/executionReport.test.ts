import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function makeValidReport() {
  return {
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Solid implementation",
  };
}

describe("ExecutionReportSchema", () => {
  it("parses a fully valid execution report and defaults executionVersion to 1", () => {
    const result = ExecutionReportSchema.parse(makeValidReport());
    expect(result.executionVersion).toBe(1);
    expect(result.score).toBe(0.75);
  });

  it("fails when score is out of the [0,1] range", () => {
    const result = ExecutionReportSchema.safeParse({ ...makeValidReport(), score: 1.2 });
    expect(result.success).toBe(false);
  });

  it("fails when a required field is missing", () => {
    const { summary: _summary, ...rest } = makeValidReport();
    const result = ExecutionReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when filesChanged is the wrong type", () => {
    const result = ExecutionReportSchema.safeParse({
      ...makeValidReport(),
      filesChanged: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  describe("CheckResultSchema status normalization", () => {
    it("passes through each known status unchanged", () => {
      expect(CheckResultSchema.parse({ status: "pass", details: "" }).status).toBe("pass");
      expect(CheckResultSchema.parse({ status: "fail", details: "" }).status).toBe("fail");
      expect(CheckResultSchema.parse({ status: "skip", details: "" }).status).toBe("skip");
    });

    it("normalizes an unrecognized status string to 'skip'", () => {
      const result = CheckResultSchema.parse({ status: "not-a-real-status", details: "weird" });
      expect(result.status).toBe("skip");
    });

    it("normalizes an unrecognized checks.tests status to 'skip' within a full report", () => {
      const report = {
        ...makeValidReport(),
        checks: {
          ...makeValidReport().checks,
          tests: { status: "timeout", details: "took too long" },
        },
      };
      const result = ExecutionReportSchema.parse(report);
      expect(result.checks.tests.status).toBe("skip");
    });
  });
});
