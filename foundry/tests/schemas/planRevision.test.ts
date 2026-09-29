import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  const base = { findingId: "f1", rationale: "because" };

  it("keeps 'accepted' as-is", () => {
    expect(DispositionItemSchema.parse({ ...base, status: "accepted" }).status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
    expect(DispositionItemSchema.parse({ ...base, status: "dismissed" }).status).toBe("dismissed");
  });

  it("normalizes 'rejected' to 'dismissed'", () => {
    expect(DispositionItemSchema.parse({ ...base, status: "rejected" }).status).toBe("dismissed");
  });

  it("normalizes an unknown synonym like 'partially_accepted' to 'partially_incorporated'", () => {
    expect(
      DispositionItemSchema.parse({ ...base, status: "partially_accepted" }).status,
    ).toBe("partially_incorporated");
  });

  it("normalizes an entirely unrecognized value to 'partially_incorporated'", () => {
    expect(DispositionItemSchema.parse({ ...base, status: "garbage" }).status).toBe(
      "partially_incorporated",
    );
  });

  it("rejects a missing findingId", () => {
    expect(DispositionItemSchema.safeParse({ status: "accepted", rationale: "x" }).success).toBe(
      false,
    );
  });
});

describe("PlanRevisionSchema", () => {
  const validRevision = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "review-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "makes sense" }],
  };

  it("parses a valid plan revision", () => {
    const result = PlanRevisionSchema.parse(validRevision);
    expect(result.dispositions[0].status).toBe("accepted");
    expect(result.originalPlanVersion).toBe(1);
    expect(result.revisedPlanVersion).toBe(2);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision, revisedPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects a missing dispositions array", () => {
    const { dispositions: _dispositions, ...missing } = validRevision;
    expect(PlanRevisionSchema.safeParse(missing).success).toBe(false);
  });
});
