import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function makeValidPlan() {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
    testPlan: "Run tests",
    confidence: 0.8,
  };
}

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.safeParse(makeValidPlan());
    expect(result.success).toBe(true);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(makeValidPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("fails when confidence is out of the [0,1] range", () => {
    const result = PlanSchema.safeParse({ ...makeValidPlan(), confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it("fails when planVersion is not a positive integer", () => {
    const result = PlanSchema.safeParse({ ...makeValidPlan(), planVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("fails when a required field is missing", () => {
    const { summary: _summary, ...rest } = makeValidPlan();
    const result = PlanSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  describe("openQuestions normalization", () => {
    it("accepts a fully-formed open question object as-is", () => {
      const result = OpenQuestionSchema.parse({
        id: "q1",
        question: "Should we cache?",
        requiredForExecution: true,
      });
      expect(result).toEqual({ id: "q1", question: "Should we cache?", requiredForExecution: true });
    });

    it("normalizes a bare string open question into the object shape", () => {
      const result = OpenQuestionSchema.parse("Should we cache?");
      expect(result.question).toBe("Should we cache?");
      expect(result.requiredForExecution).toBe(false);
      expect(typeof result.id).toBe("string");
    });

    it("defaults requiredForExecution to false via .catch() when the object form omits/mistypes it", () => {
      const result = OpenQuestionSchema.parse({
        id: "q1",
        question: "Should we cache?",
        requiredForExecution: "not-a-boolean",
      });
      expect(result.requiredForExecution).toBe(false);
    });

    it("parses a plan whose openQuestions mix object and string forms", () => {
      const plan = {
        ...makeValidPlan(),
        openQuestions: [
          { id: "q1", question: "Object form?", requiredForExecution: true },
          "String form question?",
        ],
      };
      const result = PlanSchema.parse(plan);
      expect(result.openQuestions).toHaveLength(2);
      expect(result.openQuestions[0]).toEqual({
        id: "q1",
        question: "Object form?",
        requiredForExecution: true,
      });
      expect(result.openQuestions[1]?.question).toBe("String form question?");
      expect(result.openQuestions[1]?.requiredForExecution).toBe(false);
    });
  });

  describe("FlexString coercion for assumptions/risks", () => {
    it("accepts plain strings", () => {
      const result = PlanSchema.parse({ ...makeValidPlan(), assumptions: ["A plain assumption"] });
      expect(result.assumptions).toEqual(["A plain assumption"]);
    });

    it("coerces a { risk } object to its string value", () => {
      const result = PlanSchema.parse({ ...makeValidPlan(), risks: [{ risk: "Data loss" }] });
      expect(result.risks).toEqual(["Data loss"]);
    });

    it("coerces a { description } object to its string value", () => {
      const result = PlanSchema.parse({
        ...makeValidPlan(),
        assumptions: [{ description: "Users are authenticated" }],
      });
      expect(result.assumptions).toEqual(["Users are authenticated"]);
    });

    it("falls back to an empty string for an unrecognized shape", () => {
      const result = PlanSchema.parse({ ...makeValidPlan(), risks: [{ unexpectedShape: true }] });
      expect(result.risks).toEqual([""]);
    });
  });
});
