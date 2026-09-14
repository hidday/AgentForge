import { describe, it, expect } from "vitest";
import {
  PlanRevisionSchema,
  DispositionItemSchema,
  DispositionStatus,
} from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Looks correct",
    });
    expect(result.status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable",
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

  it("normalizes any other value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("validates the normalized value against the DispositionStatus enum", () => {
    expect(DispositionStatus.options).toEqual(["accepted", "dismissed", "partially_incorporated"]);
  });
});

describe("PlanRevisionSchema", () => {
  function makeValid() {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "review-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Fixed" },
        { findingId: "f2", status: "weird-synonym", rationale: "Sort of fixed" },
      ],
    };
  }

  it("parses a well-formed plan revision and normalizes dispositions", () => {
    const result = PlanRevisionSchema.parse(makeValid());
    expect(result.dispositions[0].status).toBe("accepted");
    expect(result.dispositions[1].status).toBe("partially_incorporated");
  });

  it("rejects a non-positive originalPlanVersion", () => {
    const invalid = { ...makeValid(), originalPlanVersion: 0 };
    const result = PlanRevisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "originalPlanVersion")).toBe(
        true,
      );
    }
  });

  it("rejects a missing reviewId", () => {
    const invalid = makeValid() as Record<string, unknown>;
    delete invalid.reviewId;
    const result = PlanRevisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "reviewId")).toBe(true);
    }
  });

  it("rejects a disposition missing rationale", () => {
    const invalid = {
      ...makeValid(),
      dispositions: [{ findingId: "f1", status: "accepted" }],
    };
    const result = PlanRevisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
