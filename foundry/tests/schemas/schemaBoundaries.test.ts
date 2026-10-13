import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";
import { DispositionItemSchema } from "../../src/schemas/planRevision.js";
import { CheckResultSchema } from "../../src/schemas/executionReport.js";

describe("OpenQuestionSchema (plain-string normalization)", () => {
  it("normalizes a bare string into the object shape, defaulting requiredForExecution to false", () => {
    const result = OpenQuestionSchema.parse("Should we migrate the DB first?");

    expect(result).toEqual({
      id: "q1",
      question: "Should we migrate the DB first?",
      requiredForExecution: false,
    });
  });

  it("derives the id from the field path when normalizing inside an array", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: ["First question", "Second question"],
      risks: [],
      steps: [],
      testPlan: "tp",
      confidence: 0.5,
    });

    expect(plan.openQuestions).toEqual([
      { id: "qopenQuestions-0", question: "First question", requiredForExecution: false },
      { id: "qopenQuestions-1", question: "Second question", requiredForExecution: false },
    ]);
  });

  it("passes through a well-formed object without transformation", () => {
    const result = OpenQuestionSchema.parse({
      id: "q-custom",
      question: "Already structured?",
      requiredForExecution: true,
    });

    expect(result).toEqual({
      id: "q-custom",
      question: "Already structured?",
      requiredForExecution: true,
    });
  });

  it("defaults requiredForExecution to false when it is not a boolean (via .catch)", () => {
    const result = OpenQuestionSchema.parse({
      id: "q-bad",
      question: "Bad field?",
      requiredForExecution: "yes" as unknown as boolean,
    });

    expect(result.requiredForExecution).toBe(false);
  });
});

describe("DispositionItemSchema status normalization", () => {
  function base(status: string) {
    return { findingId: "f1", status, rationale: "because" };
  }

  it("keeps 'accepted' as-is", () => {
    expect(DispositionItemSchema.parse(base("accepted")).status).toBe("accepted");
  });

  it("normalizes 'dismissed' as-is", () => {
    expect(DispositionItemSchema.parse(base("dismissed")).status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    expect(DispositionItemSchema.parse(base("rejected")).status).toBe("dismissed");
  });

  it("normalizes any other value to 'partially_incorporated'", () => {
    expect(DispositionItemSchema.parse(base("partially_accepted")).status).toBe(
      "partially_incorporated",
    );
  });

  it("keeps 'partially_incorporated' as-is via the fallback branch", () => {
    expect(DispositionItemSchema.parse(base("partially_incorporated")).status).toBe(
      "partially_incorporated",
    );
  });
});

describe("CheckResultSchema status normalization", () => {
  it.each(["pass", "fail", "skip"] as const)("keeps known status %s as-is", (status) => {
    expect(CheckResultSchema.parse({ status, details: "d" }).status).toBe(status);
  });

  it("normalizes an unknown status string to 'skip'", () => {
    expect(CheckResultSchema.parse({ status: "errored", details: "d" }).status).toBe("skip");
  });
});
