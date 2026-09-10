import { describe, it, expect } from "vitest";
import { OpenQuestionSchema } from "../../src/schemas/plan.js";
import { DispositionItemSchema } from "../../src/schemas/planRevision.js";
import { CheckResultSchema } from "../../src/schemas/executionReport.js";

describe("OpenQuestionSchema", () => {
  it("accepts a well-formed object as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "What auth method?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "What auth method?", requiredForExecution: true });
  });

  it("normalizes a plain string into an object with requiredForExecution:false", () => {
    const result = OpenQuestionSchema.parse("What auth method?");
    expect(result.question).toBe("What auth method?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("defaults requiredForExecution to false when it fails validation on the object form", () => {
    const result = OpenQuestionSchema.parse({
      id: "q2",
      question: "Optional?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });
});

describe("DispositionItemSchema status normalization", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Makes sense",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("keeps 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes an unrecognized synonym like 'partially_accepted' to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Some merit",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes an already-correct 'partially_incorporated' to itself", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Some merit",
    });
    expect(result.status).toBe("partially_incorporated");
  });
});

describe("CheckResultSchema status normalization", () => {
  it("keeps a known status ('pass') as-is", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
  });

  it("keeps 'fail' and 'skip' as-is", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "" }).status).toBe("skip");
  });

  it("falls back to 'skip' for an unrecognized status value", () => {
    expect(CheckResultSchema.parse({ status: "unknown-status", details: "" }).status).toBe("skip");
  });
});
