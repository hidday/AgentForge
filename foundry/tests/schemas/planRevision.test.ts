import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

function makeValidRevision(overrides: Record<string, unknown> = {}) {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "rev-1",
    dispositions: [],
    ...overrides,
  };
}

describe("NormalizedDispositionStatus (via DispositionItemSchema)", () => {
  it("normalizes 'accepted' to 'accepted'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Makes sense",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' to 'dismissed'", () => {
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

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Did part of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes the exact enum value 'partially_incorporated' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Did part of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a fully-shaped revision with mixed disposition statuses", () => {
    const result = PlanRevisionSchema.parse(
      makeValidRevision({
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "r1" },
          { findingId: "f2", status: "rejected", rationale: "r2" },
        ],
      }),
    );
    expect(result.dispositions).toHaveLength(2);
    expect(result.dispositions[0].status).toBe("accepted");
    expect(result.dispositions[1].status).toBe("dismissed");
  });

  it("rejects a non-positive planVersion", () => {
    expect(() => PlanRevisionSchema.parse(makeValidRevision({ revisedPlanVersion: 0 }))).toThrow();
  });
});
