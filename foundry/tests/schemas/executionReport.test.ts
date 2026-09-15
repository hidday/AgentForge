import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema", () => {
  it("passes through a known status unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "broke" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" }).status).toBe("skip");
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    const parsed = CheckResultSchema.parse({ status: "unknown-status", details: "?" });
    expect(parsed.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  function baseFields() {
    return {
      summary: "Implemented the feature.",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "All checks pass.",
    };
  }

  it("defaults executionVersion to 1 when omitted", () => {
    const parsed = ExecutionReportSchema.parse(baseFields());
    expect(parsed.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const parsed = ExecutionReportSchema.parse({ ...baseFields(), executionVersion: 3 });
    expect(parsed.executionVersion).toBe(3);
  });

  it("rejects a score outside [0, 1]", () => {
    expect(() => ExecutionReportSchema.parse({ ...baseFields(), score: 1.1 })).toThrow();
    expect(() => ExecutionReportSchema.parse({ ...baseFields(), score: -0.1 })).toThrow();
  });

  it("rejects a non-positive or non-integer executionVersion", () => {
    expect(() => ExecutionReportSchema.parse({ ...baseFields(), executionVersion: 0 })).toThrow();
    expect(() => ExecutionReportSchema.parse({ ...baseFields(), executionVersion: 1.5 })).toThrow();
  });
});
