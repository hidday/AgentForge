import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes 'accepted' through unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Valid point.",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f2",
      status: "dismissed",
      rationale: "Out of scope.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f3",
      status: "rejected",
      rationale: "Not applicable.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f4",
      status: "partially_accepted",
      rationale: "Half addressed.",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full revision with mixed disposition status synonyms", () => {
    const revision = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Good catch." },
        { findingId: "f2", status: "rejected", rationale: "Out of scope." },
        { findingId: "f3", status: "weird-unknown-value", rationale: "Partial." },
      ],
    });
    expect(revision.dispositions.map((d) => d.status)).toEqual([
      "accepted",
      "dismissed",
      "partially_incorporated",
    ]);
  });
});
