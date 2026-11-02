import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it.each([
    ["accepted", "accepted"],
    ["dismissed", "dismissed"],
    ["rejected", "dismissed"],
    ["partially_accepted", "partially_incorporated"],
    ["something_else_entirely", "partially_incorporated"],
  ])("normalizes status %s to %s", (input, expected) => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: input,
      rationale: "because",
    });
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe(expected);
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a well-formed revision", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive plan version", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 0,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [],
    });
    expect(result.success).toBe(false);
  });
});
