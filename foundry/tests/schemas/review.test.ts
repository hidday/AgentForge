import { describe, it, expect } from "vitest";
import { FindingSchema, ReviewSchema } from "../../src/schemas/review.js";

// Note: the task listed this schema as "reviewReport.ts" / "reviewReport.test.ts",
// but no such file exists in src/schemas -- the actual review-output schema lives
// in src/schemas/review.ts, which is what this file tests.

function validFinding() {
  return {
    id: "f1",
    severity: "important" as const,
    type: "bug",
    file: "src/foo.ts",
    title: "Missing null check",
    details: "Will throw if foo is null",
  };
}

describe("FindingSchema", () => {
  it("accepts a finding without the optional lineHint field", () => {
    const parsed = FindingSchema.parse(validFinding());
    expect(parsed.lineHint).toBeUndefined();
  });

  it("accepts a finding with an integer lineHint", () => {
    const parsed = FindingSchema.parse({ ...validFinding(), lineHint: 42 });
    expect(parsed.lineHint).toBe(42);
  });

  it("rejects a non-integer lineHint", () => {
    expect(() => FindingSchema.parse({ ...validFinding(), lineHint: 4.2 })).toThrow();
  });

  it("rejects an invalid severity value", () => {
    expect(() => FindingSchema.parse({ ...validFinding(), severity: "catastrophic" })).toThrow();
  });
});

describe("ReviewSchema", () => {
  it("parses a valid review with findings", () => {
    const parsed = ReviewSchema.parse({
      reviewId: "rev-001",
      summary: "Looks mostly good",
      findings: [validFinding()],
      overallVerdict: "changes_requested",
    });
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.overallVerdict).toBe("changes_requested");
  });

  it("accepts an approved review with zero findings", () => {
    const parsed = ReviewSchema.parse({
      reviewId: "rev-002",
      summary: "All good",
      findings: [],
      overallVerdict: "approved",
    });
    expect(parsed.findings).toEqual([]);
    expect(parsed.overallVerdict).toBe("approved");
  });

  it("rejects an invalid overallVerdict", () => {
    expect(() =>
      ReviewSchema.parse({
        reviewId: "rev-003",
        summary: "x",
        findings: [],
        overallVerdict: "maybe",
      }),
    ).toThrow();
  });

  it("rejects a review missing a required field", () => {
    expect(() =>
      ReviewSchema.parse({
        summary: "x",
        findings: [],
        overallVerdict: "approved",
      }),
    ).toThrow();
  });
});
