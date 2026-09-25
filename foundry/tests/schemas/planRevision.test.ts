import { describe, it, expect } from "vitest";
import { DispositionItemSchema, PlanRevisionSchema } from "../../src/schemas/planRevision.js";

function makeDispositionItem(status: string) {
  return { findingId: "f1", status, rationale: "Because reasons." };
}

describe("DispositionItemSchema status normalization", () => {
  it("passes through 'accepted' unchanged", () => {
    const result = DispositionItemSchema.safeParse(makeDispositionItem("accepted"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("accepted");
    }
  });

  it("normalizes 'dismissed' unchanged", () => {
    const result = DispositionItemSchema.safeParse(makeDispositionItem("dismissed"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("dismissed");
    }
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.safeParse(makeDispositionItem("rejected"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("dismissed");
    }
  });

  it("normalizes any other unrecognized status to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.safeParse(makeDispositionItem("partially_accepted"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("partially_incorporated");
    }
  });
});

describe("PlanRevisionSchema", () => {
  it("parses a well-formed plan revision, normalizing disposition statuses", () => {
    const input = {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-rev-001",
      dispositions: [
        makeDispositionItem("accepted"),
        makeDispositionItem("rejected"),
        makeDispositionItem("something-else"),
      ],
    };
    const result = PlanRevisionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dispositions.map((d) => d.status)).toEqual([
        "accepted",
        "dismissed",
        "partially_incorporated",
      ]);
    }
  });
});
