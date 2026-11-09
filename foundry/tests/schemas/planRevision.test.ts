import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({ findingId: "f1", status: "accepted", rationale: "r" });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse({ findingId: "f1", status: "dismissed", rationale: "r" });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({ findingId: "f1", status: "rejected", rationale: "r" });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other/unknown value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "r",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("passes through the canonical 'partially_incorporated' value", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "r",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("rejects a disposition missing the required rationale field", () => {
    const result = DispositionItemSchema.safeParse({ findingId: "f1", status: "accepted" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string status", () => {
    const result = DispositionItemSchema.safeParse({ findingId: "f1", status: 123, rationale: "r" });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  function validRevision() {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Real bug" }],
    };
  }

  it("parses a fully valid plan revision", () => {
    const result = PlanRevisionSchema.parse(validRevision());
    expect(result.originalPlanVersion).toBe(1);
    expect(result.revisedPlanVersion).toBe(2);
    expect(result.dispositions).toHaveLength(1);
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), originalPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), revisedPlanVersion: -1 }).success,
    ).toBe(false);
  });

  it("rejects a revision missing the required reviewId field", () => {
    const { reviewId: _reviewId, ...withoutReviewId } = validRevision();
    expect(PlanRevisionSchema.safeParse(withoutReviewId).success).toBe(false);
  });

  it("rejects a revision whose dispositions array contains an invalid item", () => {
    const result = PlanRevisionSchema.safeParse({
      ...validRevision(),
      dispositions: [{ findingId: "f1", status: "accepted" }],
    });
    expect(result.success).toBe(false);
  });
});
