import { describe, it, expect } from "vitest";
import { CheckResultSchema, ChecksSchema, ExecutionReportSchema } from "../../src/schemas/executionReport.js";

describe("CheckResultSchema status normalization", () => {
  it("passes through each known status unchanged", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
    expect(CheckResultSchema.parse({ status: "fail", details: "ok" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "ok" }).status).toBe("skip");
  });

  it("maps an unknown status string to 'skip'", () => {
    const result = CheckResultSchema.parse({ status: "flaky", details: "ok" });
    expect(result.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    expect(CheckResultSchema.safeParse({ status: 1, details: "ok" }).success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("parses lint/typecheck/tests all at once", () => {
    const result = ChecksSchema.parse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "unknown-status", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    });
    expect(result.lint.status).toBe("pass");
    expect(result.typecheck.status).toBe("skip");
    expect(result.tests.status).toBe("fail");
  });

  it("rejects when a required check category is missing", () => {
    const result = ChecksSchema.safeParse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionReportSchema", () => {
  function validReport() {
    return {
      summary: "Implemented the feature.",
      filesChanged: ["src/foo.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: ["Note one"],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Solid implementation.",
    };
  }

  it("parses a fully valid execution report", () => {
    const result = ExecutionReportSchema.parse({ ...validReport(), executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
    expect(result.score).toBe(0.9);
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
  });

  it("rejects a score outside the 0-1 range", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: 1.1 }).success).toBe(false);
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score: -0.1 }).success).toBe(false);
  });

  it("rejects a non-boolean prDraftCreated", () => {
    expect(
      ExecutionReportSchema.safeParse({ ...validReport(), prDraftCreated: "yes" }).success,
    ).toBe(false);
  });

  it("rejects a report missing required checks", () => {
    const { checks: _checks, ...withoutChecks } = validReport();
    expect(ExecutionReportSchema.safeParse(withoutChecks).success).toBe(false);
  });

  it("rejects a non-positive executionVersion when explicitly provided", () => {
    expect(
      ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 0 }).success,
    ).toBe(false);
  });
});
