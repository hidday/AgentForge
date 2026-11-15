import { describe, it, expect } from "vitest";
import { DispositionItemSchema } from "../../src/schemas/planRevision.js";

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Fixed it",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not a real issue",
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

  it("normalizes any other unrecognized value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Took part of the suggestion",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});
