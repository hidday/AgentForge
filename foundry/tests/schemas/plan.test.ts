import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts a well-formed object shape as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use OAuth?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we use OAuth?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when it fails validation (via .catch)", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use OAuth?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the full object shape", () => {
    const result = OpenQuestionSchema.parse("Should we use OAuth?");
    expect(result.question).toBe("Should we use OAuth?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
  });
});

describe("PlanSchema", () => {
  function validPlan() {
    return {
      planVersion: 1,
      summary: "Do the thing",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step 1", description: "desc" }],
      testPlan: "Run tests",
      confidence: 0.8,
    };
  }

  it("accepts a fully-specified valid plan", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("normalizes a mix of string and object open questions in the same array", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      openQuestions: [
        "Plain string question?",
        { id: "q2", question: "Object question?", requiredForExecution: true },
      ],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0].question).toBe("Plain string question?");
    expect(result.openQuestions[1].question).toBe("Object question?");
  });

  it("coerces assumptions/risks given as { description } objects into strings", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ description: "Uses Postgres" }],
      risks: [{ risk: "Could break clients" }],
    });
    expect(result.assumptions).toEqual(["Uses Postgres"]);
    expect(result.risks).toEqual(["Could break clients"]);
  });

  it("coerces { text } and { assumption } shaped objects into strings", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ assumption: "Existing tests pass" }],
      risks: [{ text: "Some risk text" }],
    });
    expect(result.assumptions).toEqual(["Existing tests pass"]);
    expect(result.risks).toEqual(["Some risk text"]);
  });

  it("falls back to an empty string for an unrecognized non-string shape", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ totally: "unrecognized" }],
    });
    expect(result.assumptions).toEqual([""]);
  });

  it("rejects a plan missing required fields", () => {
    const { summary: _s, ...rest } = validPlan();
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects confidence outside the 0-1 range", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.5 }).success).toBe(false);
  });
});
