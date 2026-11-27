import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
    testPlan: "Run tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts a well-formed object form", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Use OAuth?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Use OAuth?", requiredForExecution: true });
  });

  it("transforms a plain string into the object shape with a generated id", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.startsWith("q")).toBe(true);
  });

  it("defaults requiredForExecution to false via .catch() when it's an invalid type in object form", () => {
    const result = OpenQuestionSchema.parse({
      id: "q2",
      question: "Optional?",
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("rejects a value that is neither a valid object nor a string", () => {
    const result = OpenQuestionSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("accepts a valid step", () => {
    expect(
      PlanStepSchema.safeParse({ id: "s1", title: "Title", description: "Desc" }).success,
    ).toBe(true);
  });

  it("rejects a step missing a description", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "Title" }).success).toBe(false);
  });
});

describe("PlanSchema — FlexString coercion for assumptions/risks", () => {
  it("accepts plain strings for assumptions and risks", () => {
    const plan = { ...validPlan(), assumptions: ["Assumes Postgres"], risks: ["Might break"] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.assumptions).toEqual(["Assumes Postgres"]);
    expect(parsed.risks).toEqual(["Might break"]);
  });

  it("coerces a { description } object to its string value", () => {
    const plan = { ...validPlan(), assumptions: [{ description: "From description field" }] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.assumptions).toEqual(["From description field"]);
  });

  it("coerces a { text } object to its string value", () => {
    const plan = { ...validPlan(), risks: [{ text: "From text field" }] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.risks).toEqual(["From text field"]);
  });

  it("coerces a { risk } object to its string value", () => {
    const plan = { ...validPlan(), risks: [{ risk: "From risk field" }] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.risks).toEqual(["From risk field"]);
  });

  it("coerces a { assumption } object to its string value", () => {
    const plan = { ...validPlan(), assumptions: [{ assumption: "From assumption field" }] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.assumptions).toEqual(["From assumption field"]);
  });

  it("falls back to an empty string for an unrecognized shape", () => {
    const plan = { ...validPlan(), risks: [{ somethingElse: 123 }] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.risks).toEqual([""]);
  });

  it("falls back to an empty string for a non-string, non-object value (e.g. a number)", () => {
    const plan = { ...validPlan(), assumptions: [42] };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.assumptions).toEqual([""]);
  });
});

describe("PlanSchema", () => {
  it("accepts a minimal valid plan and defaults requirementsTraceability to empty string", () => {
    const parsed = PlanSchema.parse(validPlan());
    expect(parsed.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const parsed = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Traces s1" });
    expect(parsed.requirementsTraceability).toBe("Traces s1");
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), planVersion: 0 }).success).toBe(false);
  });

  it("rejects a confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.5 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: -0.2 }).success).toBe(false);
  });

  it("accepts a plan whose openQuestions mix string and object forms", () => {
    const plan = {
      ...validPlan(),
      openQuestions: ["Plain string question", { id: "q2", question: "Object question" }],
    };
    const parsed = PlanSchema.parse(plan);
    expect(parsed.openQuestions).toHaveLength(2);
    expect(parsed.openQuestions[0].question).toBe("Plain string question");
    expect(parsed.openQuestions[1].id).toBe("q2");
  });

  it("rejects a plan missing required steps field", () => {
    const { steps, ...rest } = validPlan();
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });
});
