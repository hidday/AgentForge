import { describe, it, expect } from "vitest";
import {
  PlanRevisionSchema,
  DispositionItemSchema,
  DispositionStatus,
} from "../../src/schemas/planRevision.js";

function makeValidRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [
      { findingId: "f1", status: "accepted", rationale: "Valid concern, addressed." },
    ],
  };
}

describe("schemas/planRevision", () => {
  describe("DispositionStatus normalization", () => {
    it.each(DispositionStatus.options)("accepts the canonical status %s directly", (status) => {
      const result = DispositionItemSchema.safeParse({
        findingId: "f1",
        status,
        rationale: "r",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe(status);
    });

    it('normalizes "rejected" to "dismissed"', () => {
      const result = DispositionItemSchema.safeParse({
        findingId: "f1",
        status: "rejected",
        rationale: "r",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("dismissed");
    });

    it('normalizes an unrecognized synonym (e.g. "partially_accepted") to "partially_incorporated"', () => {
      const result = DispositionItemSchema.safeParse({
        findingId: "f1",
        status: "partially_accepted",
        rationale: "r",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("partially_incorporated");
    });

    it("rejects a non-string status", () => {
      const result = DispositionItemSchema.safeParse({ findingId: "f1", status: 1, rationale: "r" });
      expect(result.success).toBe(false);
    });
  });

  describe("PlanRevisionSchema", () => {
    it("accepts a fully valid revision", () => {
      const result = PlanRevisionSchema.safeParse(makeValidRevision());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dispositions).toHaveLength(1);
        expect(result.data.dispositions[0].status).toBe("accepted");
      }
    });

    it("accepts multiple dispositions, each normalized independently", () => {
      const revision = {
        ...makeValidRevision(),
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "r1" },
          { findingId: "f2", status: "rejected", rationale: "r2" },
          { findingId: "f3", status: "weird-synonym", rationale: "r3" },
        ],
      };
      const result = PlanRevisionSchema.safeParse(revision);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dispositions.map((d) => d.status)).toEqual([
          "accepted",
          "dismissed",
          "partially_incorporated",
        ]);
      }
    });

    it("rejects a non-positive originalPlanVersion", () => {
      const revision = { ...makeValidRevision(), originalPlanVersion: 0 };
      expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
    });

    it("rejects a non-positive revisedPlanVersion", () => {
      const revision = { ...makeValidRevision(), revisedPlanVersion: -1 };
      expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
    });

    it("rejects a revision missing required fields", () => {
      const revision = makeValidRevision() as Record<string, unknown>;
      delete revision.reviewId;
      const result = PlanRevisionSchema.safeParse(revision);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "reviewId")).toBe(true);
      }
    });

    it("rejects a disposition item missing a required field", () => {
      const revision = {
        ...makeValidRevision(),
        dispositions: [{ findingId: "f1", status: "accepted" }],
      };
      const result = PlanRevisionSchema.safeParse(revision);
      expect(result.success).toBe(false);
    });
  });
});
