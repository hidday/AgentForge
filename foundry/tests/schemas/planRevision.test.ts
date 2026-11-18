import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema (status normalization)", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Good catch",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Out of scope",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Half addressed",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes the canonical 'partially_incorporated' value unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Half addressed",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  function makeValid(overrides: Record<string, unknown> = {}) {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-001",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Valid point" },
      ],
      ...overrides,
    };
  }

  it("accepts a fully valid plan revision", () => {
    const result = PlanRevisionSchema.safeParse(makeValid());
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive originalPlanVersion", () => {
    const result = PlanRevisionSchema.safeParse(makeValid({ originalPlanVersion: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    const result = PlanRevisionSchema.safeParse(makeValid({ revisedPlanVersion: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects dispositions that are not an array", () => {
    const result = PlanRevisionSchema.safeParse(makeValid({ dispositions: "none" }));
    expect(result.success).toBe(false);
  });
});
