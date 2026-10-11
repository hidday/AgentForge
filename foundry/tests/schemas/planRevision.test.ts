import { describe, it, expect } from "vitest";
import {
  DispositionItemSchema,
  DispositionStatus,
  PlanRevisionSchema,
} from "../../src/schemas/planRevision.js";

describe("DispositionStatus enum", () => {
  it("accepts the three known literal values", () => {
    expect(DispositionStatus.safeParse("accepted").success).toBe(true);
    expect(DispositionStatus.safeParse("dismissed").success).toBe(true);
    expect(DispositionStatus.safeParse("partially_incorporated").success).toBe(true);
  });

  it("rejects an unknown literal", () => {
    expect(DispositionStatus.safeParse("something_else").success).toBe(false);
  });
});

describe("DispositionItemSchema — status normalization", () => {
  it("normalizes 'accepted' to 'accepted'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "accepted",
      rationale: "Looks good",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Out of scope",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("dismissed");
  });

  it("normalizes an unrecognized synonym like 'partially_accepted' to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of the suggestion",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    const result = DispositionItemSchema.safeParse({
      findingId: "f1",
      status: 1,
      rationale: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  const validRevision = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "review-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }],
  };

  it("accepts a fully valid revision", () => {
    expect(PlanRevisionSchema.safeParse(validRevision).success).toBe(true);
  });

  it("rejects when revisedPlanVersion is non-positive", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision, revisedPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects when dispositions is missing", () => {
    const { dispositions: _dispositions, ...rest } = validRevision;
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts an empty dispositions array", () => {
    expect(PlanRevisionSchema.safeParse({ ...validRevision, dispositions: [] }).success).toBe(true);
  });
});
