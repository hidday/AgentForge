import { describe, it, expect } from "vitest";
import {
  PlanRevisionSchema,
  DispositionItemSchema,
  DispositionStatus,
} from "../../src/schemas/planRevision.js";

function validDisposition() {
  return { findingId: "f1", status: "accepted", rationale: "Valid point" };
}

function validRevision() {
  return {
    originalPlanVersion: 1,
    revisedPlanVersion: 2,
    reviewId: "plan-rev-001",
    dispositions: [validDisposition()],
  };
}

describe("DispositionStatus", () => {
  it("accepts the three canonical statuses", () => {
    expect(DispositionStatus.safeParse("accepted").success).toBe(true);
    expect(DispositionStatus.safeParse("dismissed").success).toBe(true);
    expect(DispositionStatus.safeParse("partially_incorporated").success).toBe(true);
  });

  it("rejects an arbitrary string", () => {
    expect(DispositionStatus.safeParse("something_else").success).toBe(false);
  });
});

describe("DispositionItemSchema — status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const parsed = DispositionItemSchema.parse(validDisposition());
    expect(parsed.status).toBe("accepted");
  });

  it("keeps 'dismissed' as-is", () => {
    const parsed = DispositionItemSchema.parse({ ...validDisposition(), status: "dismissed" });
    expect(parsed.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const parsed = DispositionItemSchema.parse({ ...validDisposition(), status: "rejected" });
    expect(parsed.status).toBe("dismissed");
  });

  it("normalizes an unrecognized synonym (e.g. 'partially_accepted') to 'partially_incorporated'", () => {
    const parsed = DispositionItemSchema.parse({
      ...validDisposition(),
      status: "partially_accepted",
    });
    expect(parsed.status).toBe("partially_incorporated");
  });

  it("normalizes any other arbitrary garbage string to 'partially_incorporated'", () => {
    const parsed = DispositionItemSchema.parse({ ...validDisposition(), status: "???" });
    expect(parsed.status).toBe("partially_incorporated");
  });

  it("rejects when rationale is missing", () => {
    const { rationale, ...rest } = validDisposition();
    expect(DispositionItemSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when status is not a string", () => {
    const result = DispositionItemSchema.safeParse({ ...validDisposition(), status: 123 });
    expect(result.success).toBe(false);
  });
});

describe("PlanRevisionSchema", () => {
  it("accepts a fully valid plan revision", () => {
    expect(PlanRevisionSchema.safeParse(validRevision()).success).toBe(true);
  });

  it("accepts an empty dispositions array", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), dispositions: [] }).success,
    ).toBe(true);
  });

  it("normalizes disposition statuses nested within a full revision", () => {
    const revision = {
      ...validRevision(),
      dispositions: [{ findingId: "f1", status: "rejected", rationale: "No longer valid" }],
    };
    const parsed = PlanRevisionSchema.parse(revision);
    expect(parsed.dispositions[0].status).toBe("dismissed");
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), originalPlanVersion: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(
      PlanRevisionSchema.safeParse({ ...validRevision(), revisedPlanVersion: -1 }).success,
    ).toBe(false);
  });

  it("rejects when reviewId is missing", () => {
    const { reviewId, ...rest } = validRevision();
    expect(PlanRevisionSchema.safeParse(rest).success).toBe(false);
  });
});
