import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

const validPlan = {
  planVersion: 1,
  summary: "Do the thing",
  assumptions: ["assumption one"],
  openQuestions: [{ id: "q1", question: "Why?", requiredForExecution: true }],
  risks: ["risk one"],
  steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
  testPlan: "Run the tests",
  confidence: 0.8,
};

describe("PlanStepSchema", () => {
  it("parses a well-formed step", () => {
    expect(PlanStepSchema.parse({ id: "s1", title: "t", description: "d" })).toEqual({
      id: "s1",
      title: "t",
      description: "d",
    });
  });

  it("rejects a step missing a description", () => {
    expect(() => PlanStepSchema.parse({ id: "s1", title: "t" })).toThrow();
  });
});

describe("OpenQuestionSchema", () => {
  it("parses the full object form as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false via .catch() when it is the wrong type", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: "yes" as unknown,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the full open-question shape", () => {
    const result = OpenQuestionSchema.parse("Should validation strip unknown fields?");
    expect(result.question).toBe("Should validation strip unknown fields?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.startsWith("q")).toBe(true);
  });

  it("rejects a value that is neither an object nor a string", () => {
    expect(() => OpenQuestionSchema.parse(42)).toThrow();
  });
});

describe("PlanSchema", () => {
  it("parses a fully well-formed plan", () => {
    const result = PlanSchema.parse(validPlan);
    expect(result.planVersion).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.openQuestions[0]!.requiredForExecution).toBe(true);
  });

  it("accepts string-form open questions mixed with object-form ones", () => {
    const result = PlanSchema.parse({
      ...validPlan,
      openQuestions: ["Plain string question?", { id: "q2", question: "Obj?", requiredForExecution: true }],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0]!.question).toBe("Plain string question?");
    expect(result.openQuestions[0]!.requiredForExecution).toBe(false);
    expect(result.openQuestions[1]!.requiredForExecution).toBe(true);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const { requirementsTraceability, ...rest } = validPlan as typeof validPlan & {
      requirementsTraceability?: string;
    };
    const result = PlanSchema.parse(rest);
    expect(result.requirementsTraceability).toBe("");
  });

  it("coerces assumptions/risks given as { description } objects to their string", () => {
    const result = PlanSchema.parse({
      ...validPlan,
      assumptions: [{ description: "an assumption object" }],
      risks: [{ risk: "a risk object" }],
    });
    expect(result.assumptions).toEqual(["an assumption object"]);
    expect(result.risks).toEqual(["a risk object"]);
  });

  it("coerces assumptions/risks given as { text } or { assumption } objects", () => {
    const result = PlanSchema.parse({
      ...validPlan,
      assumptions: [{ assumption: "assumption via assumption key" }],
      risks: [{ text: "risk via text key" }],
    });
    expect(result.assumptions).toEqual(["assumption via assumption key"]);
    expect(result.risks).toEqual(["risk via text key"]);
  });

  it("falls back to an empty string for an unrecognized assumption shape", () => {
    const result = PlanSchema.parse({
      ...validPlan,
      assumptions: [{ somethingElse: 123 }],
    });
    expect(result.assumptions).toEqual([""]);
  });

  it("rejects confidence above 1", () => {
    expect(() => PlanSchema.parse({ ...validPlan, confidence: 1.5 })).toThrow();
  });

  it("rejects confidence below 0", () => {
    expect(() => PlanSchema.parse({ ...validPlan, confidence: -0.1 })).toThrow();
  });

  it("accepts the boundary confidence values 0 and 1", () => {
    expect(PlanSchema.parse({ ...validPlan, confidence: 0 }).confidence).toBe(0);
    expect(PlanSchema.parse({ ...validPlan, confidence: 1 }).confidence).toBe(1);
  });

  it("rejects a non-positive planVersion", () => {
    expect(() => PlanSchema.parse({ ...validPlan, planVersion: 0 })).toThrow();
  });

  it("rejects a non-integer planVersion", () => {
    expect(() => PlanSchema.parse({ ...validPlan, planVersion: 1.2 })).toThrow();
  });

  it("rejects when steps is missing", () => {
    const { steps, ...rest } = validPlan;
    expect(() => PlanSchema.parse(rest)).toThrow();
  });

  it("rejects when testPlan is missing", () => {
    const { testPlan, ...rest } = validPlan;
    expect(() => PlanSchema.parse(rest)).toThrow();
  });
});
