import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, ChecksSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function makeValidReport() {
  return {
    summary: "Implemented the feature and ran all checks.",
    filesChanged: ["src/foo.ts", "tests/foo.test.ts"],
    checks: {
      lint: { status: "pass", details: "no issues" },
      typecheck: { status: "pass", details: "no issues" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: ["Followed the plan exactly."],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks passed and the diff matches the plan.",
  };
}

describe("CheckResultSchema", () => {
  it("preserves a known status value (pass/fail/skip)", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "ok" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "ok" }).status).toBe("skip");
  });

  it("normalizes any unrecognized status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "pending", details: "still running" });
    expect(result.status).toBe("skip");
  });

  it("fails when details is missing", () => {
    const result = CheckResultSchema.safeParse({ status: "pass" });
    expect(result.success).toBe(false);
  });

  it("fails when status is not a string", () => {
    const result = CheckResultSchema.safeParse({ status: 1, details: "ok" });
    expect(result.success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("requires lint, typecheck and tests to all be present", () => {
    const result = ChecksSchema.safeParse({
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  it("parses a fully valid report", () => {
    const result = ExecutionReportSchema.safeParse(makeValidReport());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionVersion).toBe(1);
      expect(result.data.score).toBe(0.9);
    }
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const report = makeValidReport() as Record<string, unknown>;
    delete report.executionVersion;

    const result = ExecutionReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionVersion).toBe(1);
    }
  });

  it("accepts an explicit executionVersion greater than 1", () => {
    const report = { ...makeValidReport(), executionVersion: 3 };
    const result = ExecutionReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionVersion).toBe(3);
    }
  });

  it("rejects executionVersion 0 (not positive)", () => {
    const report = { ...makeValidReport(), executionVersion: 0 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a negative executionVersion", () => {
    const report = { ...makeValidReport(), executionVersion: -1 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a non-integer executionVersion", () => {
    const report = { ...makeValidReport(), executionVersion: 1.5 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("accepts score at the lower boundary (0)", () => {
    const report = { ...makeValidReport(), score: 0 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(true);
  });

  it("accepts score at the upper boundary (1)", () => {
    const report = { ...makeValidReport(), score: 1 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects score below 0", () => {
    const report = { ...makeValidReport(), score: -0.01 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects score above 1", () => {
    const report = { ...makeValidReport(), score: 1.01 };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a report missing a required field (summary)", () => {
    const report = makeValidReport() as Record<string, unknown>;
    delete report.summary;
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a report missing prDraftCreated", () => {
    const report = makeValidReport() as Record<string, unknown>;
    delete report.prDraftCreated;
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a non-array filesChanged", () => {
    const report = { ...makeValidReport(), filesChanged: "not-an-array" };
    expect(ExecutionReportSchema.safeParse(report).success).toBe(false);
  });

  it("normalizes an unknown check status deep inside checks to 'skip'", () => {
    const report = {
      ...makeValidReport(),
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "unknown-status", details: "" },
        tests: { status: "pass", details: "" },
      },
    };
    const result = ExecutionReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checks.typecheck.status).toBe("skip");
    }
  });
});
