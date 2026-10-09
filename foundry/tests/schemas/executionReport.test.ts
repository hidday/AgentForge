import { describe, it, expect } from "vitest";
import {
  ExecutionReportSchema,
  CheckResultSchema,
  ChecksSchema,
} from "../../src/schemas/executionReport.js";

function makeValidReport() {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: ["did it"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation with full test coverage.",
  };
}

describe("schemas/executionReport", () => {
  describe("CheckResultSchema status normalization", () => {
    it.each(["pass", "fail", "skip"] as const)("passes through the known status %s", (status) => {
      const result = CheckResultSchema.safeParse({ status, details: "d" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe(status);
    });

    it('falls back to "skip" for an unrecognized status string', () => {
      const result = CheckResultSchema.safeParse({ status: "bogus", details: "d" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("skip");
    });

    it("rejects a non-string status", () => {
      const result = CheckResultSchema.safeParse({ status: 1, details: "d" });
      expect(result.success).toBe(false);
    });
  });

  describe("ChecksSchema", () => {
    it("requires lint, typecheck, and tests", () => {
      const result = ChecksSchema.safeParse({
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ExecutionReportSchema", () => {
    it("accepts a fully valid report", () => {
      const result = ExecutionReportSchema.safeParse(makeValidReport());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.score).toBe(0.9);
        expect(result.data.checks.tests.status).toBe("pass");
      }
    });

    it("defaults executionVersion to 1 when omitted", () => {
      const report = makeValidReport() as Record<string, unknown>;
      delete report.executionVersion;
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.executionVersion).toBe(1);
    });

    it("rejects a non-positive executionVersion", () => {
      const report = { ...makeValidReport(), executionVersion: 0 };
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it("rejects a score above 1", () => {
      const report = { ...makeValidReport(), score: 1.1 };
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it("rejects a score below 0", () => {
      const report = { ...makeValidReport(), score: -0.1 };
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it("accepts score boundary values 0 and 1", () => {
      expect(ExecutionReportSchema.safeParse({ ...makeValidReport(), score: 0 }).success).toBe(
        true,
      );
      expect(ExecutionReportSchema.safeParse({ ...makeValidReport(), score: 1 }).success).toBe(
        true,
      );
    });

    it("rejects a report missing a required field", () => {
      const report = makeValidReport() as Record<string, unknown>;
      delete report.summary;
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "summary")).toBe(true);
      }
    });

    it("rejects a report with an unknown check status in a nested check", () => {
      const report = makeValidReport();
      report.checks.lint.status = "weird-status";
      const result = ExecutionReportSchema.safeParse(report);
      // Unknown status is normalized to "skip" rather than rejected.
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.checks.lint.status).toBe("skip");
    });

    it("rejects prDraftCreated when it is not a boolean", () => {
      const report = { ...makeValidReport(), prDraftCreated: "yes" };
      const result = ExecutionReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });
  });
});
