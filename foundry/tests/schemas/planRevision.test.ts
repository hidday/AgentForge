import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function validRevision(overrides: Record<string, unknown> = {}) {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "review-1",
    dispositions: [{ findingId: "f1", status: "accepted", rationale: "Addressed" }],
    ...overrides,
  };
}

describe("DispositionItemSchema normalized status", () => {
  it("normalizes 'accepted' to 'accepted'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "ok",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "ok",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "ok",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other value (e.g. a partial-acceptance synonym) to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "ok",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a fully valid plan revision", () => {
    const result = PlanRevisionSchema.parse(validRevision());
    expect(result.dispositions[0].status).toBe("accepted");
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(() => PlanRevisionSchema.parse(validRevision({ revisedPlanVersion: 0 }))).toThrow();
  });
});
