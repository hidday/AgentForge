import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

const baseStep = { id: "s1", title: "Step 1", description: "Do something" };

function validPlan() {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [baseStep],
    testPlan: "Run tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts the full object form", () => {
    const parsed = OpenQuestionSchema.parse({
      id: "q1",
      question: "Use Postgres?",
      requiredForExecution: true,
    });
    expect(parsed).toEqual({ id: "q1", question: "Use Postgres?", requiredForExecution: true });
  });

  it("normalizes a plain string into the object shape (model shorthand)", () => {
    const parsed = OpenQuestionSchema.parse("Should we use OAuth?");
    expect(parsed.question).toBe("Should we use OAuth?");
    expect(parsed.requiredForExecution).toBe(false);
    expect(typeof parsed.id).toBe("string");
    expect(parsed.id.startsWith("q")).toBe(true);
  });

  it("defaults requiredForExecution to false when it's missing or invalid in object form", () => {
    const parsed = OpenQuestionSchema.parse({ id: "q2", question: "Optional?" });
    expect(parsed.requiredForExecution).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a minimal valid plan", () => {
    const parsed = PlanSchema.parse(validPlan());
    expect(parsed.planVersion).toBe(1);
    expect(parsed.steps).toHaveLength(1);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const parsed = PlanSchema.parse(validPlan());
    expect(parsed.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const parsed = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Traces s1" });
    expect(parsed.requirementsTraceability).toBe("Traces s1");
  });

  it("accepts a mix of string and object-form openQuestions in the array", () => {
    const parsed = PlanSchema.parse({
      ...validPlan(),
      openQuestions: [
        "Plain string question",
        { id: "q2", question: "Object question", requiredForExecution: true },
      ],
    });
    expect(parsed.openQuestions).toHaveLength(2);
    expect(parsed.openQuestions[0].question).toBe("Plain string question");
    expect(parsed.openQuestions[1].requiredForExecution).toBe(true);
  });

  it("coerces risk/assumption objects with a recognizable text field via FlexString", () => {
    const parsed = PlanSchema.parse({
      ...validPlan(),
      risks: [{ risk: "Breaking change for clients" }],
      assumptions: [{ assumption: "Zod is already installed" }],
    });
    expect(parsed.risks).toEqual(["Breaking change for clients"]);
    expect(parsed.assumptions).toEqual(["Zod is already installed"]);
  });

  it("falls back to an empty string for an unrecognizable risk/assumption object shape", () => {
    const parsed = PlanSchema.parse({
      ...validPlan(),
      risks: [{ somethingElse: 123 }],
    });
    expect(parsed.risks).toEqual([""]);
  });

  it("rejects a non-positive planVersion", () => {
    expect(() => PlanSchema.parse({ ...validPlan(), planVersion: 0 })).toThrow();
  });

  it("rejects a confidence outside the [0, 1] range", () => {
    expect(() => PlanSchema.parse({ ...validPlan(), confidence: 1.5 })).toThrow();
  });

  it("rejects a plan missing required top-level fields", () => {
    const { summary: _omit, ...incomplete } = validPlan();
    expect(() => PlanSchema.parse(incomplete)).toThrow();
  });
});
