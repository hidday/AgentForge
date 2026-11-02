import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "summary",
    assumptions: ["assume x"],
    openQuestions: [],
    risks: ["risk y"],
    steps: [{ id: "s1", title: "Step 1", description: "do it" }],
    testPlan: "run tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts a well-formed object", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: "q1", question: "Should we?", requiredForExecution: true });
  });

  it("normalizes a plain string into the expected object shape", () => {
    const result = OpenQuestionSchema.safeParse("Should we use OAuth?");
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      question: "Should we use OAuth?",
      requiredForExecution: false,
    });
    expect(typeof result.data?.id).toBe("string");
  });

  it("defaults requiredForExecution to false when it fails validation", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Should we?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.success).toBe(true);
    expect(result.data?.requiredForExecution).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a fully well-formed plan", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("accepts openQuestions given as plain strings", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      openQuestions: ["Should we use OAuth?"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.openQuestions[0].question).toBe("Should we use OAuth?");
  });

  it("coerces assumptions/risks given as {description|text|risk|assumption} objects", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ assumption: "uses Fastify" }, { text: "has tests" }],
      risks: [{ risk: "breaking change" }, { description: "perf regression" }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.assumptions).toEqual(["uses Fastify", "has tests"]);
    expect(result.data?.risks).toEqual(["breaking change", "perf regression"]);
  });

  it("falls back to an empty string for an assumption/risk with no recognizable text", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ unexpectedField: 123 }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.assumptions).toEqual([""]);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.data?.requirementsTraceability).toBe("");
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), planVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a confidence value outside [0, 1]", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), confidence: 1.5 });
    expect(result.success).toBe(false);
  });
});
