import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Valid finding, addressed it",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' unchanged", () => {
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
      rationale: "Disagree with finding",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other/unknown status value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Addressed part of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes the canonical 'partially_incorporated' value unchanged (falls into the default branch)", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Half addressed",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a fully valid plan revision with mixed disposition statuses", () => {
    const result = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-001",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Fixed" },
        { findingId: "f2", status: "rejected", rationale: "Not applicable" },
        { findingId: "f3", status: "partial", rationale: "Partially done" },
      ],
    });
    expect(result.dispositions.map((d) => d.status)).toEqual([
      "accepted",
      "dismissed",
      "partially_incorporated",
    ]);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 0,
      reviewId: "rev-001",
      dispositions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when reviewId is missing", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      dispositions: [],
    });
    expect(result.success).toBe(false);
  });
});
