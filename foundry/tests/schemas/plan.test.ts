import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema, PlanStepSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the object form as-is (defaulting requiredForExecution on invalid input)", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which DB?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when it's the wrong type", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: "yes",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    const result = PlanStepSchema.parse({ id: "s1", title: "Step", description: "Do it" });
    expect(result).toEqual({ id: "s1", title: "Step", description: "Do it" });
  });

  it("rejects a step missing a required field", () => {
    expect(() => PlanStepSchema.parse({ id: "s1", title: "Step" })).toThrow();
  });
});

describe("PlanSchema FlexString fields (assumptions/risks)", () => {
  function baseParams(overrides: { assumptions?: unknown[]; risks?: unknown[] } = {}) {
    return {
      planVersion: 1,
      summary: "Summary",
      assumptions: overrides.assumptions ?? [],
      openQuestions: [],
      risks: overrides.risks ?? [],
      steps: [{ id: "s1", title: "Step", description: "Do it" }],
      testPlan: "Run tests",
      confidence: 0.9,
    };
  }

  it("accepts plain strings directly", () => {
    const result = PlanSchema.parse(baseParams({ risks: ["Plain risk"] }));
    expect(result.risks).toEqual(["Plain risk"]);
  });

  it("extracts .description from a wrapped object", () => {
    const result = PlanSchema.parse(baseParams({ risks: [{ description: "Wrapped risk" }] }));
    expect(result.risks).toEqual(["Wrapped risk"]);
  });

  it("extracts .text from a wrapped object", () => {
    const result = PlanSchema.parse(baseParams({ risks: [{ text: "Text risk" }] }));
    expect(result.risks).toEqual(["Text risk"]);
  });

  it("extracts .risk from a wrapped object", () => {
    const result = PlanSchema.parse(baseParams({ risks: [{ risk: "Risk field" }] }));
    expect(result.risks).toEqual(["Risk field"]);
  });

  it("extracts .assumption from a wrapped object", () => {
    const result = PlanSchema.parse(baseParams({ assumptions: [{ assumption: "Assumed thing" }] }));
    expect(result.assumptions).toEqual(["Assumed thing"]);
  });

  it("falls back to an empty string for an unrecognized object shape", () => {
    const result = PlanSchema.parse(baseParams({ risks: [{ somethingElse: 1 }] }));
    expect(result.risks).toEqual([""]);
  });

  it("defaults requirementsTraceability to an empty string when absent", () => {
    const result = PlanSchema.parse(baseParams());
    expect(result.requirementsTraceability).toBe("");
  });

  it("rejects a confidence value outside [0, 1]", () => {
    expect(() => PlanSchema.parse({ ...baseParams(), confidence: 1.5 })).toThrow();
  });
});
