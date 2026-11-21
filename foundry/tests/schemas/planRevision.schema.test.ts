import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalisation", () => {
  it.each([
    ["accepted", "accepted"],
    ["dismissed", "dismissed"],
    ["rejected", "dismissed"],
    ["partially_incorporated", "partially_incorporated"],
    ["partially_accepted", "partially_incorporated"],
    ["something-else", "partially_incorporated"],
  ])("maps %j to %j", (input, expected) => {
    expect(
      DispositionItemSchema.parse({ findingId: "F1", status: input, rationale: "r" }).status,
    ).toBe(expected);
  });

  it("rejects a non-string status", () => {
    expect(
      DispositionItemSchema.safeParse({ findingId: "F1", status: 1, rationale: "r" }).success,
    ).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  const valid = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "F1", status: "rejected", rationale: "out of scope" }],
  };

  it("parses a valid revision and normalises dispositions", () => {
    expect(PlanRevisionSchema.parse(valid)).toEqual({
      ...valid,
      dispositions: [{ findingId: "F1", status: "dismissed", rationale: "out of scope" }],
    });
  });

  it.each([
    ["zero originalPlanVersion", { originalPlanVersion: 0 }],
    ["fractional revisedPlanVersion", { revisedPlanVersion: 2.5 }],
    ["missing reviewId", { reviewId: undefined }],
  ])("rejects %s", (_l, overrides) => {
    expect(PlanRevisionSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });
});
