import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("parses a well-formed open question object as-is", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "q1", question: "Which DB?", requiredForExecution: true });
    }
  });

  it("normalizes a plain string into an object with a generated id and requiredForExecution:false", () => {
    const result = OpenQuestionSchema.safeParse("Should we use camelCase?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("Should we use camelCase?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(result.data.id).toMatch(/^q/);
    }
  });

  it("defaults requiredForExecution to false when the object omits it or gives a bad value", () => {
    const result = OpenQuestionSchema.safeParse({ id: "q2", question: "Optional?" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requiredForExecution).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
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
    expect(PlanSchema.safeParse(validPlan()).success).toBe(true);
  });

  it("defaults requirementsTraceability to '' when omitted", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requirementsTraceability).toBe("");
  });

  it("accepts openQuestions given as a mix of plain strings and objects", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      openQuestions: ["Plain string question?", { id: "q2", question: "Object question?" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions).toHaveLength(2);
      expect(result.data.openQuestions[0].question).toBe("Plain string question?");
      expect(result.data.openQuestions[1].question).toBe("Object question?");
    }
  });

  it("normalizes assumptions/risks given as {risk:...}/{assumption:...} objects via FlexString", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      assumptions: [{ assumption: "Uses Postgres already" }],
      risks: [{ risk: "May break the legacy import" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions).toEqual(["Uses Postgres already"]);
      expect(result.data.risks).toEqual(["May break the legacy import"]);
    }
  });

  it("falls back to an empty string for a FlexString value that matches none of the known shapes", () => {
    const result = PlanSchema.safeParse({
      ...validPlan(),
      risks: [{ somethingElse: 42 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.risks).toEqual([""]);
  });

  it("rejects a plan with confidence outside 0-1", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.2 }).success).toBe(false);
  });

  it("rejects a plan missing a required field", () => {
    const { summary: _s, ...withoutSummary } = validPlan();
    expect(PlanSchema.safeParse(withoutSummary).success).toBe(false);
  });
});
