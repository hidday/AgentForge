import { describe, it, expect } from "vitest";
import {
  DispositionStatus,
  DispositionItemSchema,
  PlanRevisionSchema,
} from "../../src/schemas/planRevision.js";

describe("DispositionStatus", () => {
  it("accepts the three canonical values", () => {
    expect(DispositionStatus.parse("accepted")).toBe("accepted");
    expect(DispositionStatus.parse("dismissed")).toBe("dismissed");
    expect(DispositionStatus.parse("partially_incorporated")).toBe("partially_incorporated");
  });

  it("rejects an unknown literal value", () => {
    expect(DispositionStatus.safeParse("rejected").success).toBe(false);
  });
});

describe("DispositionItemSchema (status normalization)", () => {
  it("normalizes 'accepted' to itself", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Valid point.",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to itself", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Out of scope.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable.",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes an unrecognized synonym like 'partially_accepted' to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Some of it applies.",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes an arbitrary unknown string to 'partially_incorporated' (fallback)", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "totally_unrelated_value",
      rationale: "Fallback case.",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    expect(
      DispositionItemSchema.safeParse({ findingId: "f1", status: 42, rationale: "x" }).success,
    ).toBe(false);
  });

  it("rejects a missing rationale", () => {
    expect(
      DispositionItemSchema.safeParse({ findingId: "f1", status: "accepted" }).success,
    ).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  const base = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }],
  };

  it("accepts a valid plan revision", () => {
    const result = PlanRevisionSchema.parse(base);
    expect(result.dispositions[0]?.status).toBe("accepted");
    expect(result.revisedPlanVersion).toBe(2);
  });

  it("accepts an empty dispositions array", () => {
    const result = PlanRevisionSchema.parse({ ...base, dispositions: [] });
    expect(result.dispositions).toEqual([]);
  });

  it("rejects a zero originalPlanVersion (must be positive)", () => {
    expect(PlanRevisionSchema.safeParse({ ...base, originalPlanVersion: 0 }).success).toBe(
      false,
    );
  });

  it("rejects a non-integer revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...base, revisedPlanVersion: 1.2 }).success,
    ).toBe(false);
  });

  it("rejects a missing reviewId", () => {
    const { reviewId, ...rest } = base;
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });
});
