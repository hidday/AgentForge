import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

function validStep() {
  return { id: "s1", title: "Step 1", description: "Do the thing" };
}

function validPlan() {
  return {
    planVersion: 1,
    summary: "A summary.",
    assumptions: ["Assumption A"],
    openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
    risks: ["Risk A"],
    steps: [validStep()],
    testPlan: "Run the tests.",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("parses a well-formed object form unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false via .catch when invalid", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the object shape with requiredForExecution: false", () => {
    const result = OpenQuestionSchema.parse("Should we use camelCase?");
    expect(result.question).toBe("Should we use camelCase?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    expect(PlanStepSchema.parse(validStep())).toEqual(validStep());
  });

  it("rejects a step missing a required field", () => {
    const { description, ...rest } = validStep();
    const result = PlanStepSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("PlanSchema (FlexString handling for assumptions/risks)", () => {
  it("parses plain string assumptions and risks unchanged", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.assumptions).toEqual(["Assumption A"]);
    expect(result.risks).toEqual(["Risk A"]);
  });

  it("coerces { description } objects to their description string", () => {
    const input = { ...validPlan(), assumptions: [{ description: "Derived from description" }] };
    const result = PlanSchema.parse(input);
    expect(result.assumptions).toEqual(["Derived from description"]);
  });

  it("coerces { text } objects to their text string", () => {
    const input = { ...validPlan(), assumptions: [{ text: "Derived from text" }] };
    const result = PlanSchema.parse(input);
    expect(result.assumptions).toEqual(["Derived from text"]);
  });

  it("coerces { risk } objects to their risk string", () => {
    const input = { ...validPlan(), risks: [{ risk: "Derived from risk" }] };
    const result = PlanSchema.parse(input);
    expect(result.risks).toEqual(["Derived from risk"]);
  });

  it("coerces { assumption } objects to their assumption string", () => {
    const input = { ...validPlan(), assumptions: [{ assumption: "Derived from assumption" }] };
    const result = PlanSchema.parse(input);
    expect(result.assumptions).toEqual(["Derived from assumption"]);
  });

  it("falls back to empty string for an unrecognized object shape", () => {
    const input = { ...validPlan(), assumptions: [{ somethingElse: 1 }] };
    const result = PlanSchema.parse(input);
    expect(result.assumptions).toEqual([""]);
  });

  it("defaults requirementsTraceability to empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("uses the provided requirementsTraceability when present", () => {
    const input = { ...validPlan(), requirementsTraceability: "Covers REQ-1" };
    const result = PlanSchema.parse(input);
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  it("rejects planVersion of zero (must be positive)", () => {
    const input = { ...validPlan(), planVersion: 0 };
    const result = PlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside the 0-1 range", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: -0.1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.1 }).success).toBe(false);
  });

  it("rejects a plan missing the required steps field", () => {
    const { steps, ...rest } = validPlan();
    const result = PlanSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
