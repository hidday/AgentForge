import { describe, it, expect } from "vitest";
import { CheckResultSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("passes through known status %s unchanged", (status) => {
    const result = CheckResultSchema.parse({ status, details: "ok" });
    expect(result.status).toBe(status);
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "crashed" });
    expect(result.status).toBe("skip");
  });
});

describe("ExecutionReportSchema", () => {
  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      summary: "Implemented the feature",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "All checks pass",
      ...overrides,
    };
  }

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(baseInput());
    expect(result.executionVersion).toBe(1);
  });

  it("keeps an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse(baseInput({ executionVersion: 4 }));
    expect(result.executionVersion).toBe(4);
  });

  it("normalizes an unrecognized check status to 'skip' within the full report", () => {
    const result = ExecutionReportSchema.parse(
      baseInput({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "weird", details: "?" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );
    expect(result.checks.typecheck.status).toBe("skip");
  });

  it("rejects a score outside [0, 1]", () => {
    const result = ExecutionReportSchema.safeParse(baseInput({ score: 1.1 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive explicit executionVersion", () => {
    const result = ExecutionReportSchema.safeParse(baseInput({ executionVersion: 0 }));
    expect(result.success).toBe(false);
  });
});
