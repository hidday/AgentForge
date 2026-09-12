import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validDisposition() {
  return { findingId: "f1", status: "accepted", rationale: "Valid point" };
}

function validRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-001",
    dispositions: [validDisposition()],
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.safeParse({ ...validDisposition(), status: "accepted" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("accepted");
  });

  it("normalizes 'dismissed' and 'rejected' to 'dismissed'", () => {
    const dismissed = DispositionItemSchema.safeParse({
      ...validDisposition(),
      status: "dismissed",
    });
    const rejected = DispositionItemSchema.safeParse({
      ...validDisposition(),
      status: "rejected",
    });
    expect(dismissed.success && dismissed.data.status).toBe("dismissed");
    expect(rejected.success && rejected.data.status).toBe("dismissed");
  });

  it("normalizes any other/unknown status synonym to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse({
      ...validDisposition(),
      status: "partially_accepted",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    const result = DispositionItemSchema.safeParse({ ...validDisposition(), status: 123 });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a valid revision", () => {
    expect(PlanRevisionSchema.safeParse(validRevision()).success).toBe(true);
  });

  it("accepts an empty dispositions array", () => {
    expect(PlanRevisionSchema.safeParse({ ...validRevision(), dispositions: [] }).success).toBe(
      true,
    );
  });

  it("rejects a non-positive originalPlanVersion or revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), originalPlanVersion: 0 }).success,
    ).toBe(false);
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), revisedPlanVersion: -1 }).success,
    ).toBe(false);
  });

  it("rejects when reviewId is missing", () => {
    const { reviewId: _reviewId, ...rest } = validRevision();
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a malformed disposition entry inside the array", () => {
    const result = PlanRevisionSchema.safeParse({
      ...validRevision(),
      dispositions: [{ findingId: "f1" }],
    });
    expect(result.success).toBe(false);
  });
});
