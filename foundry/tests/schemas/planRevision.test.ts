import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Valid point",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Out of scope",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes an unrecognized synonym (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Did part of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes 'partially_incorporated' itself unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Some of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a valid revision with multiple dispositions", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "ok" },
        { findingId: "f2", status: "rejected", rationale: "no" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions[1].status).toBe("dismissed");
    }
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 0,
      revisedPlanVersion: 1,
      reviewId: "rev-1",
      dispositions: [],
    });
    expect(result.success).toBe(false);
  });
});
