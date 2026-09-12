import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

function validStep() {
  return { id: "s1", title: "Step 1", description: "Do a thing" };
}

function validPlan() {
  return {
    planVersion: 1,
    summary: "A plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [validStep()],
    testPlan: "Run tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts a well-formed object form", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Should we use X?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        id: "q1",
        question: "Should we use X?",
        requiredForExecution: true,
      });
    }
  });

  it("defaults requiredForExecution to false via .catch() when invalid", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Should we use X?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requiredForExecution).toBe(false);
  });

  it("transforms a plain string into the expected object shape", () => {
    const result = OpenQuestionSchema.safeParse("Should we use X?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("Should we use X?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(typeof result.data.id).toBe("string");
    }
  });

  it("rejects a value that is neither a valid object nor a string", () => {
    const result = OpenQuestionSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("accepts a valid step", () => {
    expect(PlanStepSchema.safeParse(validStep()).success).toBe(true);
  });

  it("rejects a step missing a required field", () => {
    const { title: _title, ...rest } = validStep();
    expect(PlanStepSchema.safeParse(rest).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("accepts a minimal valid plan and defaults requirementsTraceability to empty string", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requirementsTraceability).toBe("");
  });

  it("accepts assumptions and risks as plain strings", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: ["Assume X"],
      risks: ["Risk Y"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions).toEqual(["Assume X"]);
      expect(result.data.risks).toEqual(["Risk Y"]);
    }
  });

  it("coerces assumption/risk objects with description/text/risk/assumption keys to strings", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ description: "Assume via description" }, { text: "Assume via text" }],
      risks: [{ risk: "Risk via risk key" }, { assumption: "not really a risk key but allowed" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions).toEqual(["Assume via description", "Assume via text"]);
      expect(result.data.risks).toEqual(["Risk via risk key", "not really a risk key but allowed"]);
    }
  });

  it("falls back to an empty string for an assumption that matches no known shape", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ unrelatedKey: "value" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assumptions).toEqual([""]);
  });

  it("rejects confidence outside the 0-1 range", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: -0.1 }).success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), planVersion: 0 }).success).toBe(false);
  });

  it("accepts a mix of object and string openQuestions", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      openQuestions: [
        { id: "q1", question: "Object form?", requiredForExecution: true },
        "String form?",
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions).toHaveLength(2);
      expect(result.data.openQuestions[1].question).toBe("String form?");
    }
  });

  it("rejects when steps is missing", () => {
    const { steps: _steps, ...rest } = validPlan();
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });
});
