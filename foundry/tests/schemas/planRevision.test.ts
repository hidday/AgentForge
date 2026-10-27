import { describe, it, expect } from "vitest";
import {
  DispositionStatus,
  DispositionItemSchema,
  PlanRevisionSchema,
} from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema normalization", () => {
  it("passes through 'accepted' as-is", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "accepted", rationale: "r" }).status,
    ).toBe("accepted");
  });

  it("passes through 'dismissed' as-is", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "dismissed", rationale: "r" }).status,
    ).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "rejected", rationale: "r" }).status,
    ).toBe("dismissed");
  });

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "partially_accepted", rationale: "r" })
        .status,
    ).toBe("partially_incorporated");
  });

  it("passes through the canonical 'partially_incorporated' value", () => {
    expect(
      DispositionItemSchema.parse({
        findingId: "f1",
        status: "partially_incorporated",
        rationale: "r",
      }).status,
    ).toBe("partially_incorporated");
  });

  it("normalizes a totally unrecognized status string to 'partially_incorporated'", () => {
    expect(
      DispositionItemSchema.parse({ findingId: "f1", status: "garbage", rationale: "r" }).status,
    ).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    expect(() =>
      DispositionItemSchema.parse({ findingId: "f1", status: 123, rationale: "r" }),
    ).toThrow();
  });

  it("rejects when rationale is missing", () => {
    expect(() => DispositionItemSchema.parse({ findingId: "f1", status: "accepted" })).toThrow();
  });
});

describe("DispositionStatus enum", () => {
  it("accepts all three canonical values", () => {
    for (const v of ["accepted", "dismissed", "partially_incorporated"]) {
      expect(DispositionStatus.parse(v)).toBe(v);
    }
  });

  it("rejects an arbitrary string directly against the raw enum", () => {
    expect(() => DispositionStatus.parse("rejected")).toThrow();
  });
});

describe("PlanRevisionSchema", () => {
  const validRevision = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "good catch" }],
  };

  it("parses a well-formed revision", () => {
    const result = PlanRevisionSchema.parse(validRevision);
    expect(result.originalPlanVersion).toBe(1);
    expect(result.dispositions).toHaveLength(1);
  });

  it("accepts an empty dispositions array", () => {
    const result = PlanRevisionSchema.parse({ ...validRevision, dispositions: [] });
    expect(result.dispositions).toEqual([]);
  });

  it("rejects revisedPlanVersion of zero (must be positive)", () => {
    expect(() => PlanRevisionSchema.parse({ ...validRevision, revisedPlanVersion: 0 })).toThrow();
  });

  it("rejects a non-integer originalPlanVersion", () => {
    expect(() =>
      PlanRevisionSchema.parse({ ...validRevision, originalPlanVersion: 1.5 }),
    ).toThrow();
  });

  it("rejects when reviewId is missing", () => {
    const { reviewId, ...rest } = validRevision;
    expect(() => PlanRevisionSchema.parse(rest)).toThrow();
  });

  it("rejects when dispositions is missing", () => {
    const { dispositions, ...rest } = validRevision;
    expect(() => PlanRevisionSchema.parse(rest)).toThrow();
  });

  it("propagates normalization through nested dispositions", () => {
    const result = PlanRevisionSchema.parse({
      ...validRevision,
      dispositions: [{ findingId: "f2", status: "rejected", rationale: "out of scope" }],
    });
    expect(result.dispositions[0]!.status).toBe("dismissed");
  });
});
