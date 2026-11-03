import { describe, it, expect } from "vitest";
import {
  DispositionStatus,
  DispositionItemSchema,
  PlanRevisionSchema,
} from "../../src/schemas/planRevision.js";

describe("DispositionStatus", () => {
  it.each(["accepted", "dismissed", "partially_incorporated"] as const)(
    "accepts the canonical value %s",
    (value) => {
      expect(DispositionStatus.parse(value)).toBe(value);
    },
  );

  it("rejects a value outside the enum", () => {
    expect(DispositionStatus.safeParse("something-else").success).toBe(false);
  });
});

describe("DispositionItemSchema (normalizes synonyms via NormalizedDispositionStatus)", () => {
  function item(status: string) {
    return { findingId: "f1", status, rationale: "because" };
  }

  it("keeps 'accepted' as-is", () => {
    expect(DispositionItemSchema.parse(item("accepted")).status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
    expect(DispositionItemSchema.parse(item("dismissed")).status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    expect(DispositionItemSchema.parse(item("rejected")).status).toBe("dismissed");
  });

  it("normalizes an unrecognized value (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    expect(DispositionItemSchema.parse(item("partially_accepted")).status).toBe(
      "partially_incorporated",
    );
  });

  it("normalizes an arbitrary unknown string to 'partially_incorporated'", () => {
    expect(DispositionItemSchema.parse(item("totally-unexpected")).status).toBe(
      "partially_incorporated",
    );
  });

  it("rejects a non-string status", () => {
    expect(DispositionItemSchema.safeParse({ ...item("accepted"), status: 1 }).success).toBe(false);
  });

  it("requires rationale and findingId", () => {
    expect(DispositionItemSchema.safeParse({ status: "accepted" }).success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  function validRevision() {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "good catch" }],
    };
  }

  it("parses a valid revision, normalizing disposition statuses", () => {
    const result = PlanRevisionSchema.parse({
      ...validRevision(),
      dispositions: [{ findingId: "f1", status: "rejected", rationale: "out of scope" }],
    });
    expect(result.dispositions[0]!.status).toBe("dismissed");
  });

  it("allows an empty dispositions array", () => {
    const result = PlanRevisionSchema.parse({ ...validRevision(), dispositions: [] });
    expect(result.dispositions).toEqual([]);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), revisedPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), originalPlanVersion: -1 }).success,
    ).toBe(false);
  });

  it("fails when reviewId is missing", () => {
    const { reviewId: _reviewId, ...rest } = validRevision();
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });
});
