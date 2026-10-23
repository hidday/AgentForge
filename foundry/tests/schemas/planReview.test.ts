import { describe, it, expect } from "vitest";
import {
  PlanReviewFindingSeverity,
  PlanReviewVerdict,
  PlanReviewFindingSchema,
  PlanReviewSchema,
} from "../../src/schemas/planReview.js";

describe("PlanReviewFindingSeverity / PlanReviewVerdict", () => {
  it("accepts every declared severity", () => {
    for (const s of ["blocker", "important", "suggestion", "nit"]) {
      expect(PlanReviewFindingSeverity.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown severity", () => {
    expect(PlanReviewFindingSeverity.safeParse("urgent").success).toBe(false);
  });

  it("accepts both declared verdicts", () => {
    expect(PlanReviewVerdict.parse("approved")).toBe("approved");
    expect(PlanReviewVerdict.parse("changes_requested")).toBe("changes_requested");
  });
});

describe("PlanReviewFindingSchema", () => {
  const base = {
    id: "pf1",
    severity: "suggestion",
    type: "scope",
    title: "Consider X",
    details: "Detail",
  };

  it("accepts a finding without the optional affectedStepId", () => {
    const result = PlanReviewFindingSchema.parse(base);
    expect(result.affectedStepId).toBeUndefined();
  });

  it("accepts a finding with affectedStepId", () => {
    const result = PlanReviewFindingSchema.parse({ ...base, affectedStepId: "s1" });
    expect(result.affectedStepId).toBe("s1");
  });

  it("rejects an invalid severity", () => {
    expect(PlanReviewFindingSchema.safeParse({ ...base, severity: "bad" }).success).toBe(false);
  });
});

describe("PlanReviewSchema", () => {
  it("accepts a full plan review", () => {
    const result = PlanReviewSchema.parse({
      reviewId: "plan-rev-1",
      summary: "Solid plan",
      findings: [
        {
          id: "pf1",
          severity: "blocker",
          type: "missing_requirement",
          affectedStepId: "s1",
          title: "Missing step",
          details: "Need to add a step",
        },
      ],
      overallVerdict: "changes_requested",
    });
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings[0]?.affectedStepId).toBe("s1");
  });

  it("rejects a review missing the summary field", () => {
    expect(
      PlanReviewSchema.safeParse({
        reviewId: "plan-rev-1",
        findings: [],
        overallVerdict: "approved",
      }).success,
    ).toBe(false);
  });
});
