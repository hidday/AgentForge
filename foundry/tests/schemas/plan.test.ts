import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Plan summary",
    assumptions: ["Assumes Postgres"],
    openQuestions: [{ id: "q1", question: "Which auth flow?", requiredForExecution: true }],
    risks: ["Might break migrations"],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
    testPlan: "Run all tests",
    confidence: 0.9,
  };
}

describe("OpenQuestionSchema", () => {
  it("parses an object-form open question unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Q?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Q?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false via .catch() when invalid", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Q?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string open question into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should we use camelCase?");
    expect(result.question).toBe("Should we use camelCase?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    const result = PlanStepSchema.parse({ id: "s1", title: "T", description: "D" });
    expect(result).toEqual({ id: "s1", title: "T", description: "D" });
  });

  it("rejects a step missing a required field", () => {
    expect(() => PlanStepSchema.parse({ id: "s1", title: "T" })).toThrow();
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.planVersion).toBe(1);
    expect(result.steps).toHaveLength(1);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const result = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Covers REQ-1" });
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  it("normalizes assumptions given as plain strings", () => {
    const result = PlanSchema.parse({ ...validPlan(), assumptions: ["Plain string assumption"] });
    expect(result.assumptions).toEqual(["Plain string assumption"]);
  });

  it("normalizes assumptions given as {assumption: string} objects", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ assumption: "Structured assumption" }],
    });
    expect(result.assumptions).toEqual(["Structured assumption"]);
  });

  it("normalizes risks given as {risk: string} objects", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [{ risk: "Structured risk" }] });
    expect(result.risks).toEqual(["Structured risk"]);
  });

  it("normalizes risks given as {description: string} objects", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [{ description: "Desc risk" }] });
    expect(result.risks).toEqual(["Desc risk"]);
  });

  it("normalizes risks given as {text: string} objects", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [{ text: "Text risk" }] });
    expect(result.risks).toEqual(["Text risk"]);
  });

  it("falls back to an empty string for a risk of an unrecognized shape", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [{ unexpected: 123 }] });
    expect(result.risks).toEqual([""]);
  });

  it("falls back to an empty string for a non-string, non-object risk value", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [42] });
    expect(result.risks).toEqual([""]);
  });

  it("rejects a non-positive planVersion", () => {
    expect(() => PlanSchema.parse({ ...validPlan(), planVersion: 0 })).toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() => PlanSchema.parse({ ...validPlan(), confidence: 1.5 })).toThrow();
    expect(() => PlanSchema.parse({ ...validPlan(), confidence: -0.1 })).toThrow();
  });

  it("rejects a plan missing steps", () => {
    const { steps: _steps, ...rest } = validPlan();
    expect(() => PlanSchema.parse(rest)).toThrow();
  });

  it("normalizes a mix of string and object open questions in the same plan", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      openQuestions: ["Plain question?", { id: "q2", question: "Structured?", requiredForExecution: false }],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0].question).toBe("Plain question?");
    expect(result.openQuestions[1].question).toBe("Structured?");
  });
});
