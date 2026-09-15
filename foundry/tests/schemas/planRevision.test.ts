import { describe, it, expect } from "vitest";
import {
  DispositionStatus,
  DispositionItemSchema,
  PlanRevisionSchema,
} from "../../src/schemas/planRevision.js";

describe("DispositionStatus", () => {
  it("accepts the three known values", () => {
    expect(DispositionStatus.parse("accepted")).toBe("accepted");
    expect(DispositionStatus.parse("dismissed")).toBe("dismissed");
    expect(DispositionStatus.parse("partially_incorporated")).toBe("partially_incorporated");
  });

  it("rejects an unknown value", () => {
    expect(DispositionStatus.safeParse("bogus").success).toBe(false);
  });
});

describe("DispositionItemSchema", () => {
  it("parses 'accepted' status unchanged", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "good point",
    });
    expect(item.status).toBe("accepted");
  });

  it("normalizes 'dismissed' status unchanged", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "out of scope",
    });
    expect(item.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "out of scope",
    });
    expect(item.status).toBe("dismissed");
  });

  it("normalizes any other unknown value to 'partially_incorporated'", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "somewhat addressed",
    });
    expect(item.status).toBe("partially_incorporated");
  });

  it("fails when rationale is missing", () => {
    const result = DispositionItemSchema.safeParse({ findingId: "f1", status: "accepted" });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  const validRevision = {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "good point" }],
  };

  it("parses a valid plan revision", () => {
    const parsed = PlanRevisionSchema.parse(validRevision);
    expect(parsed.revisedPlanVersion).toBe(2);
    expect(parsed.dispositions[0]?.status).toBe("accepted");
  });

  it("fails when revisedPlanVersion is not a positive integer", () => {
    const result = PlanRevisionSchema.safeParse({ ...validRevision, revisedPlanVersion: -1 });
    expect(result.success).toBe(false);
  });

  it("fails when dispositions is missing", () => {
    const { dispositions: _omit, ...rest } = validRevision;
    const result = PlanRevisionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
