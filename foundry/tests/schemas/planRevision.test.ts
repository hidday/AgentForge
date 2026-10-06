import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema's normalized status", () => {
  it("passes 'accepted' through unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Agreed",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Rejected by reviewer",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other/unknown value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of the suggestion",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes the canonical 'partially_incorporated' unchanged (falls through to the same default branch)", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Took part of the suggestion",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("fails when rationale is missing", () => {
    const result = DispositionItemSchema.safeParse({ findingId: "f1", status: "accepted" });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  const validDisposition = {
    findingId: "f1",
    status: "accepted",
    rationale: "Agreed",
  };

  it("parses a valid plan revision", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
      dispositions: [validDisposition],
    });
    expect(result.success).toBe(true);
  });

  it("fails when revisedPlanVersion is not a positive integer", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 0,
      reviewId: "review-1",
      dispositions: [validDisposition],
    });
    expect(result.success).toBe(false);
  });

  it("fails when dispositions is missing", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
    });
    expect(result.success).toBe(false);
  });
});
