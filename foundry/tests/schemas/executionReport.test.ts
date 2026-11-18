import { describe, it, expect } from "vitest";
import { CheckResultSchema, ChecksSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema", () => {
  it.each(["pass", "fail", "skip"])("keeps a known status value as-is (%s)", (status) => {
    const result = CheckResultSchema.parse({ status, details: "ok" });
    expect(result.status).toBe(status);
  });

  it("normalizes an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "errored", details: "weird model output" });
    expect(result.status).toBe("skip");
  });
});

describe("ChecksSchema", () => {
  it("accepts lint/typecheck/tests check results, normalizing unknown statuses", () => {
    const result = ChecksSchema.parse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "unexpected", details: "weird" },
      tests: { status: "fail", details: "1 failing" },
    });
    expect(result.lint.status).toBe("pass");
    expect(result.typecheck.status).toBe("skip");
    expect(result.tests.status).toBe("fail");
  });
});

describe("ExecutionReportSchema", () => {
  function makeValid(overrides: Record<string, unknown> = {}) {
    return {
      summary: "Did the work",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.8,
      scoreRationale: "Looks good",
      ...overrides,
    };
  }

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(makeValid());
    expect(result.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse(makeValid({ executionVersion: 3 }));
    expect(result.executionVersion).toBe(3);
  });

  it("rejects a score outside [0, 1]", () => {
    const result = ExecutionReportSchema.safeParse(makeValid({ score: 1.5 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean prDraftCreated", () => {
    const result = ExecutionReportSchema.safeParse(makeValid({ prDraftCreated: "yes" }));
    expect(result.success).toBe(false);
  });
});
