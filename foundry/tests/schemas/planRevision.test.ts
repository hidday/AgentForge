import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "Valid concern" }],
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' unchanged", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "accepted",
      rationale: "ok",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "dismissed",
      rationale: "ok",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes an unrecognized status (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Half addressed",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a fully valid plan revision", () => {
    expect(PlanRevisionSchema.safeParse(validRevision()).success).toBe(true);
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), originalPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects a revision missing a required field", () => {
    const { reviewId: _r, ...withoutReviewId } = validRevision();
    expect(PlanRevisionSchema.safeParse(withoutReviewId).success).toBe(false);
  });

  it("normalizes disposition status synonyms within a full revision", () => {
    const result = PlanRevisionSchema.safeParse({
      ...validRevision(),
      dispositions: [
        { findingId: "f1", status: "rejected", rationale: "no" },
        { findingId: "f2", status: "weird-value", rationale: "unclear" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions[0].status).toBe("dismissed");
      expect(result.data.dispositions[1].status).toBe("partially_incorporated");
    }
  });
});
