import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "s",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "t",
    confidence: 0.5,
    ...overrides,
  };
}

describe("OpenQuestionSchema", () => {
  it("normalises a bare string into a non-blocking question with a default id", () => {
    expect(OpenQuestionSchema.parse("Which region?")).toEqual({
      id: "q1",
      question: "Which region?",
      requiredForExecution: false,
    });
  });

  it("coerces an invalid requiredForExecution to false via .catch", () => {
    expect(
      OpenQuestionSchema.parse({ id: "x", question: "y", requiredForExecution: "maybe" }),
    ).toEqual({ id: "x", question: "y", requiredForExecution: false });
  });

  it("keeps a valid object as-is", () => {
    const q = { id: "q9", question: "Ok?", requiredForExecution: true };
    expect(OpenQuestionSchema.parse(q)).toEqual(q);
  });

  it("rejects values that are neither a string nor a question object", () => {
    expect(OpenQuestionSchema.safeParse(42).success).toBe(false);
    expect(OpenQuestionSchema.safeParse({ question: "missing id" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("normalises string open questions inside a plan with distinct, index-derived ids", () => {
    const plan = PlanSchema.parse(
      basePlan({
        openQuestions: ["First?", "Second?", { id: "keep", question: "Third?", requiredForExecution: true }],
      }),
    );
    const [a, b, c] = plan.openQuestions;
    expect(a.question).toBe("First?");
    expect(b.question).toBe("Second?");
    expect(a.requiredForExecution).toBe(false);
    expect(a.id).toMatch(/^q.*0$/);
    expect(b.id).toMatch(/^q.*1$/);
    expect(a.id).not.toBe(b.id);
    expect(c).toEqual({ id: "keep", question: "Third?", requiredForExecution: true });
  });

  it("flattens object-shaped assumptions/risks and blanks unrecognised values", () => {
    const plan = PlanSchema.parse(
      basePlan({
        assumptions: [{ description: "d" }, { text: "t" }, { assumption: "a" }, 7],
        risks: ["plain", { risk: "r" }, null],
      }),
    );
    expect(plan.assumptions).toEqual(["d", "t", "a", ""]);
    expect(plan.risks).toEqual(["plain", "r", ""]);
  });

  it("defaults requirementsTraceability to an empty string", () => {
    expect(PlanSchema.parse(basePlan()).requirementsTraceability).toBe("");
  });

  it.each([
    ["non-positive planVersion", { planVersion: 0 }],
    ["fractional planVersion", { planVersion: 1.5 }],
    ["confidence above 1", { confidence: 1.01 }],
    ["confidence below 0", { confidence: -0.1 }],
    ["step missing description", { steps: [{ id: "s1", title: "t" }] }],
  ])("rejects %s", (_label, overrides) => {
    expect(PlanSchema.safeParse(basePlan(overrides)).success).toBe(false);
  });
});
