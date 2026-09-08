import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("planRevision schema", () => {
  describe("DispositionItemSchema normalization", () => {
    it("keeps 'accepted' as-is", () => {
      const parsed = DispositionItemSchema.parse({
        findingId: "f1",
        status: "accepted",
        rationale: "looks good",
      });
      expect(parsed.status).toBe("accepted");
    });

    it("normalizes 'dismissed' and 'rejected' to 'dismissed'", () => {
      expect(
        DispositionItemSchema.parse({ findingId: "f1", status: "dismissed", rationale: "n/a" })
          .status,
      ).toBe("dismissed");
      expect(
        DispositionItemSchema.parse({ findingId: "f1", status: "rejected", rationale: "n/a" })
          .status,
      ).toBe("dismissed");
    });

    it("normalizes unrecognized synonyms to 'partially_incorporated'", () => {
      expect(
        DispositionItemSchema.parse({
          findingId: "f1",
          status: "partially_accepted",
          rationale: "sort of",
        }).status,
      ).toBe("partially_incorporated");
      expect(
        DispositionItemSchema.parse({
          findingId: "f1",
          status: "something_unexpected",
          rationale: "unclear",
        }).status,
      ).toBe("partially_incorporated");
    });
  });

  describe("PlanRevisionSchema", () => {
    it("parses a full revision with mixed disposition statuses", () => {
      const result = PlanRevisionSchema.parse({
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "rev-1",
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "ok" },
          { findingId: "f2", status: "rejected", rationale: "no" },
        ],
      });
      expect(result.dispositions.map((d) => d.status)).toEqual(["accepted", "dismissed"]);
    });

    it("rejects a non-positive plan version", () => {
      expect(() =>
        PlanRevisionSchema.parse({
          originalPlanVersion: 0,
          revisedPlanVersion: 1,
          reviewId: "rev-1",
          dispositions: [],
        }),
      ).toThrow();
    });
  });
});
