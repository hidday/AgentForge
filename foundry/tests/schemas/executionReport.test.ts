import { describe, it, expect } from "vitest";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

describe("executionReport schema", () => {
  describe("CheckResultSchema", () => {
    it("keeps a known status as-is", () => {
      expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
      expect(CheckResultSchema.parse({ status: "fail", details: "broke" }).status).toBe("fail");
    });

    it("falls back to 'skip' for an unrecognized status value", () => {
      expect(CheckResultSchema.parse({ status: "flaky", details: "unclear" }).status).toBe("skip");
    });
  });

  describe("ExecutionReportSchema", () => {
    it("parses a full valid report and defaults executionVersion to 1", () => {
      const result = ExecutionReportSchema.parse({
        summary: "did the thing",
        filesChanged: ["a.ts"],
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.9,
        scoreRationale: "clean",
      });
      expect(result.executionVersion).toBe(1);
    });

    it("rejects a score outside [0, 1]", () => {
      expect(() =>
        ExecutionReportSchema.parse({
          summary: "x",
          filesChanged: [],
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
          notes: [],
          prDraftCreated: false,
          score: 1.5,
          scoreRationale: "x",
        }),
      ).toThrow();
    });
  });
});
