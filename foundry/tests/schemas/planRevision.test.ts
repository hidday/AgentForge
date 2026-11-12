import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validDisposition(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findingId: "f1",
    status: "accepted",
    rationale: "Makes sense",
    ...overrides,
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse(validDisposition({ status: "accepted" }));
    expect(result.status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse(validDisposition({ status: "dismissed" }));
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse(validDisposition({ status: "rejected" }));
    expect(result.status).toBe("dismissed");
  });

  it("keeps 'partially_incorporated' as-is", () => {
    const result = DispositionItemSchema.parse(
      validDisposition({ status: "partially_incorporated" }),
    );
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes an unknown synonym (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse(
      validDisposition({ status: "partially_accepted" }),
    );
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes a completely unrecognized value to 'partially_incorporated' too", () => {
    const result = DispositionItemSchema.parse(validDisposition({ status: "garbage" }));
    expect(result.status).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    const result = DispositionItemSchema.safeParse(validDisposition({ status: 123 }));
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full valid revision", () => {
    const result = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
      dispositions: [validDisposition(), validDisposition({ status: "rejected" })],
    });
    expect(result.dispositions).toHaveLength(2);
    expect(result.dispositions[1].status).toBe("dismissed");
  });

  it("rejects non-positive plan versions", () => {
    expect(
      PlanRevisionSchema.safeParse({
        originalPlanVersion: 0,
        revisedPlanVersion: 2,
        reviewId: "r1",
        dispositions: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a revision missing required fields", () => {
    expect(
      PlanRevisionSchema.safeParse({
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        dispositions: [],
      }).success,
    ).toBe(false);
  });

  it("allows an empty dispositions array", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "r1",
      dispositions: [],
    });
    expect(result.success).toBe(true);
  });
});
