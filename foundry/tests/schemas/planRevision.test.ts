import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "accepted", rationale: "r" }).status,
    ).toBe("accepted");
  });

  it("normalizes 'dismissed' and the synonym 'rejected' to 'dismissed'", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "dismissed", rationale: "r" }).status,
    ).toBe("dismissed");
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "rejected", rationale: "r" }).status,
    ).toBe("dismissed");
  });

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    expect(
      DispositionItemSchema.parse({
        findingId: "f1",
        status: "partially_accepted",
        rationale: "r",
      }).status,
    ).toBe("partially_incorporated");
    expect(
      DispositionItemSchema.parse({
        findingId: "f1",
        status: "partially_incorporated",
        rationale: "r",
      }).status,
    ).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full valid revision with multiple dispositions", () => {
    const parsed = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Fixed as suggested." },
        { findingId: "f2", status: "rejected", rationale: "Out of scope." },
      ],
    });
    expect(parsed.dispositions.map((d) => d.status)).toEqual(["accepted", "dismissed"]);
  });

  it("rejects non-positive plan versions", () => {
    expect(() =>
      PlanRevisionSchema.parse({
        originalPlanVersion: 0,
        revisedPlanVersion: 2,
        reviewId: "review-1",
        dispositions: [],
      }),
    ).toThrow();
  });
});
