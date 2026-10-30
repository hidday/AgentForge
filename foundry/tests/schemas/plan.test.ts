import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: ["Node 22 is available"],
    openQuestions: [],
    risks: ["Might break CI"],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run the test suite",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts the object form as-is", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "What env?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "q1", question: "What env?", requiredForExecution: true });
    }
  });

  it("defaults requiredForExecution to false via .catch() when invalid", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "What env?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredForExecution).toBe(false);
    }
  });

  it("normalizes a plain string into the expected object shape", () => {
    const result = OpenQuestionSchema.safeParse("What database should we use?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("What database should we use?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(typeof result.data.id).toBe("string");
      expect(result.data.id.length).toBeGreaterThan(0);
    }
  });
});

describe("PlanSchema", () => {
  it("accepts a fully valid plan", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirementsTraceability).toBe("");
    }
  });

  it("accepts string-form openQuestions mixed with object-form ones", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      openQuestions: ["Plain string question", { id: "q2", question: "Object question", requiredForExecution: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions[0]?.question).toBe("Plain string question");
      expect(result.data.openQuestions[0]?.requiredForExecution).toBe(false);
      expect(result.data.openQuestions[1]?.question).toBe("Object question");
    }
  });

  it("applies the requirementsTraceability default when omitted", () => {
    const { requirementsTraceability, ...rest } = { ...validPlan(), requirementsTraceability: undefined };
    const result = PlanSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirementsTraceability).toBe("");
    }
  });

  it("coerces assumptions/risks given as { description } or { risk } objects via FlexString", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ description: "An assumption object" }],
      risks: [{ risk: "A risk object" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions[0]).toBe("An assumption object");
      expect(result.data.risks[0]).toBe("A risk object");
    }
  });

  it("coerces an unrecognized assumption shape to an empty string via FlexString's fallback", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ somethingElse: 123 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions[0]).toBe("");
    }
  });

  it("rejects confidence above 1", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanSchema.safeParse({ ...validPlan(), planVersion: 0 });
    expect(result.success).toBe(false);
  });
});
