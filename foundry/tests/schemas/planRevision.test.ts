import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

function makeValidRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "Valid concern" }],
  };
}

describe("PlanRevisionSchema", () => {
  it("parses a fully valid plan revision", () => {
    const result = PlanRevisionSchema.safeParse(makeValidRevision());
    expect(result.success).toBe(true);
  });

  it("fails when revisedPlanVersion is not a positive integer", () => {
    const result = PlanRevisionSchema.safeParse({ ...makeValidRevision(), revisedPlanVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("fails when a required field is missing", () => {
    const { reviewId: _reviewId, ...rest } = makeValidRevision();
    const result = PlanRevisionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  describe("DispositionItemSchema status normalization", () => {
    it("passes 'accepted' through unchanged", () => {
      const result = DispositionItemSchema.parse({
        findingId: "f1",
        status: "accepted",
        rationale: "r",
      });
      expect(result.status).toBe("accepted");
    });

    it("normalizes 'dismissed' unchanged to 'dismissed'", () => {
      const result = DispositionItemSchema.parse({
        findingId: "f1",
        status: "dismissed",
        rationale: "r",
      });
      expect(result.status).toBe("dismissed");
    });

    it("normalizes the synonym 'rejected' to 'dismissed'", () => {
      const result = DispositionItemSchema.parse({
        findingId: "f1",
        status: "rejected",
        rationale: "r",
      });
      expect(result.status).toBe("dismissed");
    });

    it("normalizes any other unrecognized value to 'partially_incorporated'", () => {
      const result = DispositionItemSchema.parse({
        findingId: "f1",
        status: "partially_accepted",
        rationale: "r",
      });
      expect(result.status).toBe("partially_incorporated");
    });
  });
});
