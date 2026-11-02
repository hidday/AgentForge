import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function validReport() {
  return {
    summary: "done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
  };
}

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"])("accepts the known status %s as-is", (status) => {
    const result = CheckResultSchema.safeParse({ status, details: "" });
    expect(result.data?.status).toBe(status);
  });

  it("falls back to skip for an unrecognized status value", () => {
    const result = CheckResultSchema.safeParse({ status: "unknown-status", details: "" });
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.safeParse(validReport());
    expect(result.data?.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 3 });
    expect(result.data?.executionVersion).toBe(3);
  });

  it("rejects a score outside [0, 1]", () => {
    const result = ExecutionReportSchema.safeParse({ ...validReport(), score: 1.1 });
    expect(result.success).toBe(false);
  });
});
