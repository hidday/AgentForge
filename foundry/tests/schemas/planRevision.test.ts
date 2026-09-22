import { describe, it, expect } from "vitest";
import {
  PlanRevisionSchema,
  DispositionItemSchema,
  DispositionStatus,
} from "../../src/schemas/planRevision.js";

describe("DispositionStatus", () => {
  it("accepts the three canonical values", () => {
    expect(DispositionStatus.parse("accepted")).toBe("accepted");
    expect(DispositionStatus.parse("dismissed")).toBe("dismissed");
    expect(DispositionStatus.parse("partially_incorporated")).toBe("partially_incorporated");
  });

  it("rejects an arbitrary string", () => {
    expect(() => DispositionStatus.parse("bogus")).toThrow();
  });
});

describe("DispositionItemSchema (NormalizedDispositionStatus)", () => {
  it("passes 'accepted' through unchanged", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Real bug",
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
      rationale: "Disagree",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other unrecognized value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Some of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes an empty string to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "",
      rationale: "Unclear",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("rejects a non-string status", () => {
    expect(() =>
      DispositionItemSchema.parse({ findingId: "f1", status: 1, rationale: "x" }),
    ).toThrow();
  });

  it("rejects a missing findingId", () => {
    expect(() =>
      DispositionItemSchema.parse({ status: "accepted", rationale: "x" }),
    ).toThrow();
  });
});

describe("PlanRevisionSchema", () => {
  function validRevision() {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-001",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed" }],
    };
  }

  it("parses a fully valid plan revision", () => {
    const result = PlanRevisionSchema.parse(validRevision());
    expect(result.revisedPlanVersion).toBe(2);
    expect(result.dispositions).toHaveLength(1);
  });

  it("normalizes dispositions' statuses within the revision", () => {
    const result = PlanRevisionSchema.parse({
      ...validRevision(),
      dispositions: [{ findingId: "f2", status: "rejected", rationale: "No" }],
    });
    expect(result.dispositions[0].status).toBe("dismissed");
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(() =>
      PlanRevisionSchema.parse({ ...validRevision(), originalPlanVersion: 0 }),
    ).toThrow();
  });

  it("rejects a non-positive revisedPlanVersion", () => {
    expect(() =>
      PlanRevisionSchema.parse({ ...validRevision(), revisedPlanVersion: -1 }),
    ).toThrow();
  });

  it("rejects a missing reviewId", () => {
    const { reviewId: _reviewId, ...rest } = validRevision();
    expect(() => PlanRevisionSchema.parse(rest)).toThrow();
  });

  it("accepts an empty dispositions array", () => {
    const result = PlanRevisionSchema.parse({ ...validRevision(), dispositions: [] });
    expect(result.dispositions).toEqual([]);
  });
});
