import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Looks good.",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Reviewer disagreed.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other/unknown status value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of the suggestion.",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes a completely unrecognized string the same way", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "something-else-entirely",
      rationale: "N/A",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full plan revision with mixed disposition statuses", () => {
    const revision = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Fixed." },
        { findingId: "f2", status: "rejected", rationale: "Disagree." },
        { findingId: "f3", status: "partially_accepted", rationale: "Half-fixed." },
      ],
    });

    expect(revision.dispositions.map((d) => d.status)).toEqual([
      "accepted",
      "dismissed",
      "partially_incorporated",
    ]);
  });
});
