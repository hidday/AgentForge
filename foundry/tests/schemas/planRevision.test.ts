import { describe, it, expect } from "vitest";
import { PlanRevisionSchema, DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' unchanged", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Good point",
    });
    expect(item.status).toBe("accepted");
  });

  it("normalizes 'rejected' to 'dismissed'", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Out of scope",
    });
    expect(item.status).toBe("dismissed");
  });

  it("passes through 'dismissed' unchanged", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable",
    });
    expect(item.status).toBe("dismissed");
  });

  it("normalizes an unknown synonym like 'partially_accepted' to 'partially_incorporated'", () => {
    const item = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of the suggestion",
    });
    expect(item.status).toBe("partially_incorporated");
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a full revision with multiple dispositions", () => {
    const revision = PlanRevisionSchema.parse({
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "r1" },
        { findingId: "f2", status: "rejected", rationale: "r2" },
      ],
    });
    expect(revision.dispositions.map((d) => d.status)).toEqual(["accepted", "dismissed"]);
  });
});
