import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema / NormalizedDispositionStatus", () => {
  it("passes through 'accepted' unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Looks right",
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
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Half fixed",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full revision with multiple dispositions", () => {
    const result = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Real issue" },
        { findingId: "f2", status: "weird-value", rationale: "Unclear" },
      ],
    });
    expect(result.dispositions[0]?.status).toBe("accepted");
    expect(result.dispositions[1]?.status).toBe("partially_incorporated");
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    const result = PlanRevisionSchema.safeParse({
      originalPlanVersion: 1,
      revisedPlanVersion: 0,
      reviewId: "rev-1",
      dispositions: [],
    });
    expect(result.success).toBe(false);
  });
});
