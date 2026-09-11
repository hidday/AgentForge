import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

function validPlan() {
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

describe("OpenQuestionSchema", () => {
  it("accepts the full object form as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: true,
    });
    expect(result).toEqual({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: true,
    });
  });

  it("defaults requiredForExecution to false via .catch() when omitted/invalid", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Optional field?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into an object with a generated id and requiredForExecution: false", () => {
    const result = OpenQuestionSchema.parse("Should we use camelCase?");
    expect(result.question).toBe("Should we use camelCase?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanStepSchema", () => {
  it("accepts a valid step", () => {
    expect(
      PlanStepSchema.safeParse({ id: "s1", title: "Step", description: "Do it" }).success,
    ).toBe(true);
  });

  it("rejects a step missing a required field", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "Step" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.planVersion).toBe(1);
    expect(result.requirementsTraceability).toBe("");
  });

  it("normalizes plain-string openQuestions entries within a full plan parse", () => {
    const plan = { ...validPlan(), openQuestions: ["Plain string question?"] };
    const result = PlanSchema.parse(plan);
    expect(result.openQuestions).toHaveLength(1);
    expect(result.openQuestions[0].question).toBe("Plain string question?");
    expect(result.openQuestions[0].requiredForExecution).toBe(false);
  });

  it("coerces a risk object with a `risk` field into its string value via FlexString", () => {
    const plan = { ...validPlan(), risks: [{ risk: "Might break auth" }] };
    const result = PlanSchema.parse(plan);
    expect(result.risks).toEqual(["Might break auth"]);
  });

  it("coerces an assumption object with an `assumption` field into its string value", () => {
    const plan = { ...validPlan(), assumptions: [{ assumption: "DB already migrated" }] };
    const result = PlanSchema.parse(plan);
    expect(result.assumptions).toEqual(["DB already migrated"]);
  });

  it("falls back to an empty string for an unrecognized risk shape", () => {
    const plan = { ...validPlan(), risks: [{ unexpectedShape: true }] };
    const result = PlanSchema.parse(plan);
    expect(result.risks).toEqual([""]);
  });

  it("rejects when confidence is out of range", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), confidence: 1.2 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), planVersion: 0 });
    expect(result.success).toBe(false);
  });
});
