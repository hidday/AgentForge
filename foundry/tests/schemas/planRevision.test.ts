import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "plan-rev-001",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "Valid point" }],
  };
}

describe("DispositionItemSchema status normalization", () => {
  it("accepts 'accepted' as-is", () => {
    const parsed = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "ok",
    });
    expect(parsed.status).toBe("accepted");
  });

  it("accepts 'dismissed' as-is", () => {
    const parsed = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "out of scope",
    });
    expect(parsed.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const parsed = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "out of scope",
    });
    expect(parsed.status).toBe("dismissed");
  });

  it("normalizes any other unrecognized value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const parsed = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "half done",
    });
    expect(parsed.status).toBe("partially_incorporated");
  });

  it("passes through the canonical 'partially_incorporated' value", () => {
    const parsed = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "half done",
    });
    expect(parsed.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a valid plan revision", () => {
    const parsed = PlanRevisionSchema.parse(validRevision());
    expect(parsed.originalPlanVersion).toBe(1);
    expect(parsed.revisedPlanVersion).toBe(2);
    expect(parsed.dispositions).toHaveLength(1);
  });

  it("accepts an empty dispositions array", () => {
    const parsed = PlanRevisionSchema.parse({ ...validRevision(), dispositions: [] });
    expect(parsed.dispositions).toEqual([]);
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(() => PlanRevisionSchema.parse({ ...validRevision(), originalPlanVersion: 0 })).toThrow();
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(() => PlanRevisionSchema.parse({ ...validRevision(), revisedPlanVersion: -1 })).toThrow();
  });

  it("rejects a revision missing a required field", () => {
    const { reviewId: _omit, ...incomplete } = validRevision();
    expect(() => PlanRevisionSchema.parse(incomplete)).toThrow();
  });
});
