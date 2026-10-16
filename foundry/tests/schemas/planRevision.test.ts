import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validDisposition() {
  return { findingId: "f1", status: "accepted", rationale: "Addressed in v2." };
}

function validRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "review-1",
    dispositions: [validDisposition()],
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' unchanged", () => {
    const result = DispositionItemSchema.parse(validDisposition());
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.parse({ ...validDisposition(), status: "dismissed" });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({ ...validDisposition(), status: "rejected" });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other unknown value (including the synonym 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      ...validDisposition(),
      status: "partially_accepted",
    });
    expect(result.status).toBe("partially_incorporated");

    const result2 = DispositionItemSchema.parse({
      ...validDisposition(),
      status: "partially_incorporated",
    });
    expect(result2.status).toBe("partially_incorporated");

    const result3 = DispositionItemSchema.parse({
      ...validDisposition(),
      status: "some-totally-unrecognized-value",
    });
    expect(result3.status).toBe("partially_incorporated");
  });

  it("rejects a disposition missing a required field", () => {
    const { rationale, ...rest } = validDisposition();
    const result = DispositionItemSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a valid revision", () => {
    const result = PlanRevisionSchema.parse(validRevision());
    expect(result.originalPlanVersion).toBe(1);
    expect(result.revisedPlanVersion).toBe(2);
    expect(result.dispositions).toHaveLength(1);
  });

  it("rejects originalPlanVersion of zero (must be positive)", () => {
    const input = { ...validRevision(), originalPlanVersion: 0 };
    const result = PlanRevisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects revisedPlanVersion of zero (must be positive)", () => {
    const input = { ...validRevision(), revisedPlanVersion: 0 };
    const result = PlanRevisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer revisedPlanVersion", () => {
    const input = { ...validRevision(), revisedPlanVersion: 2.5 };
    const result = PlanRevisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a revision missing the required dispositions field", () => {
    const { dispositions, ...rest } = validRevision();
    const result = PlanRevisionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts an empty dispositions array", () => {
    const result = PlanRevisionSchema.safeParse({ ...validRevision(), dispositions: [] });
    expect(result.success).toBe(true);
  });
});
