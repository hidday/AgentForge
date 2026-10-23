import { describe, it, expect } from "vitest";
import { FindingSeverity, OverallVerdict, FindingSchema, ReviewSchema } from "../../src/schemas/review.js";

describe("FindingSeverity / OverallVerdict enums", () => {
  it("accepts every declared severity", () => {
    for (const s of ["blocker", "important", "suggestion", "nit"]) {
      expect(FindingSeverity.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown severity", () => {
    expect(FindingSeverity.safeParse("critical").success).toBe(false);
  });

  it("accepts every declared verdict", () => {
    expect(OverallVerdict.parse("approved")).toBe("approved");
    expect(OverallVerdict.parse("changes_requested")).toBe("changes_requested");
  });

  it("rejects an unknown verdict", () => {
    expect(OverallVerdict.safeParse("rejected").success).toBe(false);
  });
});

describe("FindingSchema", () => {
  const base = {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/x.ts",
    title: "Something",
    details: "Detailed explanation",
  };

  it("accepts a finding without the optional lineHint", () => {
    const result = FindingSchema.parse(base);
    expect(result.lineHint).toBeUndefined();
  });

  it("accepts a finding with an integer lineHint", () => {
    const result = FindingSchema.parse({ ...base, lineHint: 42 });
    expect(result.lineHint).toBe(42);
  });

  it("rejects a non-integer lineHint", () => {
    expect(FindingSchema.safeParse({ ...base, lineHint: 1.5 }).success).toBe(false);
  });

  it("rejects an invalid severity value", () => {
    expect(FindingSchema.safeParse({ ...base, severity: "urgent" }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { file, ...rest } = base;
    expect(FindingSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ReviewSchema", () => {
  const finding = {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "src/x.ts",
    title: "Nit",
    details: "Minor",
  };

  it("accepts a review with findings and an approved verdict", () => {
    const result = ReviewSchema.parse({
      reviewId: "r1",
      summary: "Looks good",
      findings: [finding],
      overallVerdict: "approved",
    });
    expect(result.findings).toHaveLength(1);
  });

  it("accepts a review with no findings", () => {
    const result = ReviewSchema.parse({
      reviewId: "r1",
      summary: "Nothing to report",
      findings: [],
      overallVerdict: "approved",
    });
    expect(result.findings).toEqual([]);
  });

  it("rejects an invalid overallVerdict", () => {
    expect(
      ReviewSchema.safeParse({
        reviewId: "r1",
        summary: "x",
        findings: [],
        overallVerdict: "maybe",
      }).success,
    ).toBe(false);
  });

  it("rejects when findings contains an invalid item", () => {
    expect(
      ReviewSchema.safeParse({
        reviewId: "r1",
        summary: "x",
        findings: [{ ...finding, severity: "unknown" }],
        overallVerdict: "approved",
      }).success,
    ).toBe(false);
  });
});
