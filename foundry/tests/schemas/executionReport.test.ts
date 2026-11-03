import { describe, it, expect } from "vitest";
import {
  CheckResultSchema,
  ChecksSchema,
  ExecutionReportSchema,
} from "../../src/schemas/executionReport.js";

describe("CheckResultSchema", () => {
  it.each(["pass", "fail", "skip"] as const)(
    "preserves a known status value %s",
    (status) => {
      const result = CheckResultSchema.parse({ status, details: "ran fine" });
      expect(result.status).toBe(status);
    },
  );

  it("falls back to 'skip' when the status is an unrecognized string", () => {
    const result = CheckResultSchema.parse({ status: "not-a-real-status", details: "weird" });
    expect(result.status).toBe("skip");
  });

  it("falls back to 'skip' for an empty status string", () => {
    const result = CheckResultSchema.parse({ status: "", details: "" });
    expect(result.status).toBe("skip");
  });

  it("rejects a non-string status", () => {
    expect(CheckResultSchema.safeParse({ status: 1, details: "x" }).success).toBe(false);
  });

  it("requires details", () => {
    expect(CheckResultSchema.safeParse({ status: "pass" }).success).toBe(false);
  });
});

describe("ChecksSchema", () => {
  it("parses lint/typecheck/tests, normalizing any unknown statuses", () => {
    const result = ChecksSchema.parse({
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "weird-value", details: "ok" },
      tests: { status: "fail", details: "1 failed" },
    });
    expect(result.lint.status).toBe("pass");
    expect(result.typecheck.status).toBe("skip");
    expect(result.tests.status).toBe("fail");
  });
});

describe("ExecutionReportSchema", () => {
  function validChecks() {
    return {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    };
  }

  function validReport() {
    return {
      summary: "Implemented the feature",
      filesChanged: ["src/a.ts"],
      checks: validChecks(),
      notes: ["note 1"],
      prDraftCreated: true,
      score: 0.8,
      scoreRationale: "All checks pass",
    };
  }

  it("defaults executionVersion to 1 when omitted", () => {
    const result = ExecutionReportSchema.parse(validReport());
    expect(result.executionVersion).toBe(1);
  });

  it("accepts an explicit executionVersion", () => {
    const result = ExecutionReportSchema.parse({ ...validReport(), executionVersion: 3 });
    expect(result.executionVersion).toBe(3);
  });

  it.each([0, 1])("accepts the score boundary value %i", (score) => {
    expect(() => ExecutionReportSchema.parse({ ...validReport(), score })).not.toThrow();
  });

  it.each([-0.01, 1.01])("rejects a score outside [0,1]: %s", (score) => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), score }).success).toBe(false);
  });

  it("rejects a non-positive executionVersion", () => {
    expect(ExecutionReportSchema.safeParse({ ...validReport(), executionVersion: 0 }).success).toBe(
      false,
    );
  });

  it("fails when checks is missing", () => {
    const { checks: _checks, ...rest } = validReport();
    expect(ExecutionReportSchema.safeParse(rest).success).toBe(false);
  });
});
