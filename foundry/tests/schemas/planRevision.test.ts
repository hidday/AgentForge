import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

function validRevision(overrides: Record<string, unknown> = {}) {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "review-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "Addressed" }],
    ...overrides,
  };
}

describe("DispositionItemSchema normalization", () => {
  it("normalizes 'accepted' to 'accepted'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "accepted",
      rationale: "r",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "dismissed",
      rationale: "r",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "rejected",
      rationale: "r",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes any other unrecognized status to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "r",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });

  it("accepts the canonical 'partially_incorporated' value directly", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "r",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a fully valid plan revision", () => {
    expect(PlanRevisionSchema.safeParse(validRevision()).success).toBe(true);
  });

  it("accepts multiple dispositions with varied statuses", () => {
    const result = PlanRevisionSchema.safeParse(
      validRevision({
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "a" },
          { findingId: "f2", status: "rejected", rationale: "b" },
          { findingId: "f3", status: "unknown_value", rationale: "c" },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions.map((d) => d.status)).toEqual([
        "accepted",
        "dismissed",
        "partially_incorporated",
      ]);
    }
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(PlanRevisionSchema.safeParse(validRevision({ originalPlanVersion: 0 })).success).toBe(
      false,
    );
  });

  it("rejects when dispositions is missing", () => {
    const { dispositions, ...rest } = validRevision();
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });
});
