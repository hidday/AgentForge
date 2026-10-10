import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

function validRevision(overrides: Record<string, unknown> = {}) {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [],
    ...overrides,
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("normalizes 'accepted' to 'accepted'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "accepted",
      rationale: "good point",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "dismissed",
      rationale: "out of scope",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "rejected",
      rationale: "out of scope",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes any other unknown synonym (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "half addressed",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });

  it("normalizes the canonical 'partially_incorporated' value to itself", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "half addressed",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a valid revision with normalized dispositions", () => {
    const result = PlanRevisionSchema.safeParse(
      validRevision({
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "r1" },
          { findingId: "f2", status: "rejected", rationale: "r2" },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions[0].status).toBe("accepted");
      expect(result.data.dispositions[1].status).toBe("dismissed");
    }
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(PlanRevisionSchema.safeParse(validRevision({ originalPlanVersion: 0 })).success).toBe(
      false,
    );
  });

  it("rejects a missing reviewId", () => {
    const { reviewId, ...rest } = validRevision();
    expect(reviewId).toBeDefined();
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });
});
