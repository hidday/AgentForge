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
    reviewId: "review-1",
    dispositions: [
      { findingId: "f1", status: "accepted", rationale: "Makes sense." },
    ],
  };
}

describe("DispositionStatus", () => {
  it("accepts the three known statuses", () => {
    expect(DispositionStatus.safeParse("accepted").success).toBe(true);
    expect(DispositionStatus.safeParse("dismissed").success).toBe(true);
    expect(DispositionStatus.safeParse("partially_incorporated").success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(DispositionStatus.safeParse("rejected").success).toBe(false);
  });
});

describe("DispositionItemSchema — status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "r",
    });
    expect(result.status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
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

  it("normalizes 'partially_incorporated' as itself (falls through default)", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "r",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes any other unrecognized synonym (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "r",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("rejects when status is not a string", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: 1,
      rationale: "r",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when rationale is missing", () => {
    const result = DispositionItemSchema.safeParse({ findingId: "f1", status: "accepted" });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a fully valid revision", () => {
    const result = PlanRevisionSchema.safeParse(makeValidRevision());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions[0]!.status).toBe("accepted");
    }
  });

  it("parses a revision with multiple dispositions using different status synonyms", () => {
    const revision = {
      ...makeValidRevision(),
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "r1" },
        { findingId: "f2", status: "rejected", rationale: "r2" },
        { findingId: "f3", status: "partially_accepted", rationale: "r3" },
      ],
    };
    const result = PlanRevisionSchema.parse(revision);
    expect(result.dispositions.map((d) => d.status)).toEqual([
      "accepted",
      "dismissed",
      "partially_incorporated",
    ]);
  });

  it("accepts an empty dispositions array", () => {
    const revision = { ...makeValidRevision(), dispositions: [] };
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(true);
  });

  it("rejects originalPlanVersion 0 (not positive)", () => {
    const revision = { ...makeValidRevision(), originalPlanVersion: 0 };
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
  });

  it("rejects a non-integer revisedPlanVersion", () => {
    const revision = { ...makeValidRevision(), revisedPlanVersion: 2.5 };
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
  });

  it("rejects a negative revisedPlanVersion", () => {
    const revision = { ...makeValidRevision(), revisedPlanVersion: -2 };
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
  });

  it("rejects a revision missing reviewId", () => {
    const revision = makeValidRevision() as Record<string, unknown>;
    delete revision.reviewId;
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
  });

  it("rejects a revision whose dispositions array contains an invalid item", () => {
    const revision = {
      ...makeValidRevision(),
      dispositions: [{ findingId: "f1", status: "accepted" }],
    };
    expect(PlanRevisionSchema.safeParse(revision).success).toBe(false);
  });
});
