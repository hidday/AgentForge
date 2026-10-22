import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it.each([
    ["accepted", "accepted"],
    ["dismissed", "dismissed"],
    ["rejected", "dismissed"],
    ["partially_accepted", "partially_incorporated"],
    ["something_unexpected", "partially_incorporated"],
  ])("normalizes model value %s to %s", (input, expected) => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: input,
      rationale: "because",
    });
    expect(result.status).toBe(expected);
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a valid revision with normalized dispositions", () => {
    const result = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Real bug" },
        { findingId: "f2", status: "rejected", rationale: "Style nit" },
      ],
    });
    expect(result.dispositions[0]?.status).toBe("accepted");
    expect(result.dispositions[1]?.status).toBe("dismissed");
  });

  it("rejects a non-positive planVersion", () => {
    expect(() =>
      PlanRevisionSchema.parse({
        originalPlanVersion: 0,
        revisedPlanVersion: 1,
        reviewId: "rev-1",
        dispositions: [],
      }),
    ).toThrow();
  });

  it("rejects when a required field is missing", () => {
    expect(() =>
      PlanRevisionSchema.parse({
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        dispositions: [],
      }),
    ).toThrow();
  });
});
