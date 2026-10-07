import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "Summary",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

describe("OpenQuestionSchema", () => {
  it("passes through a well-formed object unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we cache?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we cache?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when invalid via .catch()", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we cache?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into a question object with a generated id", () => {
    const result = OpenQuestionSchema.parse("Should validation strip unknown fields?");
    expect(result.question).toBe("Should validation strip unknown fields?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanSchema", () => {
  it("parses a fully-formed plan", () => {
    const plan = PlanSchema.parse(
      basePlan({
        steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
      }),
    );
    expect(plan.steps).toHaveLength(1);
  });

  it("normalizes a mix of string and object openQuestions within the same plan", () => {
    const plan = PlanSchema.parse(
      basePlan({
        openQuestions: ["Plain question?", { id: "q2", question: "Structured?", requiredForExecution: true }],
      }),
    );
    expect(plan.openQuestions).toHaveLength(2);
    expect(plan.openQuestions[0]?.question).toBe("Plain question?");
    expect(plan.openQuestions[1]?.question).toBe("Structured?");
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const plan = PlanSchema.parse(basePlan());
    expect(plan.requirementsTraceability).toBe("");
  });

  it("coerces assumptions/risks given as {description}, {text}, {risk}, or {assumption} objects", () => {
    const plan = PlanSchema.parse(
      basePlan({
        assumptions: [{ description: "from description" }, { assumption: "from assumption" }],
        risks: [{ text: "from text" }, { risk: "from risk" }],
      }),
    );
    expect(plan.assumptions).toEqual(["from description", "from assumption"]);
    expect(plan.risks).toEqual(["from text", "from risk"]);
  });

  it("falls back to an empty string for an assumption/risk shape it doesn't recognize", () => {
    const plan = PlanSchema.parse(
      basePlan({
        assumptions: [{ unrecognized: "shape" }],
        risks: [12345],
      }),
    );
    expect(plan.assumptions).toEqual([""]);
    expect(plan.risks).toEqual([""]);
  });

  it("rejects a plan with confidence outside [0, 1]", () => {
    expect(() => PlanSchema.parse(basePlan({ confidence: 1.5 }))).toThrow();
  });
});
