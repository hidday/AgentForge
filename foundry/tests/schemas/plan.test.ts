import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the full object form unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we do X?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we do X?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false via .catch when invalid", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we do X?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should validation strip unknown fields?");
    expect(result.question).toBe("Should validation strip unknown fields?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.startsWith("q")).toBe(true);
  });

  it("rejects a value that is neither an object nor a string", () => {
    expect(OpenQuestionSchema.safeParse(42).success).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("accepts a valid step", () => {
    const result = PlanStepSchema.parse({ id: "s1", title: "Do thing", description: "Details" });
    expect(result.id).toBe("s1");
  });

  it("rejects a step missing a description", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "Do thing" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  const baseStep = { id: "s1", title: "Step one", description: "Do the thing" };

  const minimalPlan = {
    planVersion: 1,
    summary: "A plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [baseStep],
    testPlan: "Run tests",
    confidence: 0.5,
  };

  it("accepts a minimal valid plan and defaults requirementsTraceability to ''", () => {
    const result = PlanSchema.parse(minimalPlan);
    expect(result.requirementsTraceability).toBe("");
  });

  it("accepts assumptions/risks as plain strings (FlexString passthrough)", () => {
    const result = PlanSchema.parse({
      ...minimalPlan,
      assumptions: ["Uses Fastify"],
      risks: ["Could break clients"],
    });
    expect(result.assumptions).toEqual(["Uses Fastify"]);
    expect(result.risks).toEqual(["Could break clients"]);
  });

  it("coerces FlexString object variants ({description}/{text}/{risk}/{assumption})", () => {
    const result = PlanSchema.parse({
      ...minimalPlan,
      assumptions: [{ assumption: "From object" }, { description: "Also from object" }],
      risks: [{ risk: "Risk from object" }, { text: "Risk from text field" }],
    });
    expect(result.assumptions).toEqual(["From object", "Also from object"]);
    expect(result.risks).toEqual(["Risk from object", "Risk from text field"]);
  });

  it("falls back to an empty string for an unrecognized FlexString shape", () => {
    const result = PlanSchema.parse({
      ...minimalPlan,
      assumptions: [{ somethingElse: 123 }],
    });
    expect(result.assumptions).toEqual([""]);
  });

  it("accepts openQuestions mixing object and plain-string forms", () => {
    const result = PlanSchema.parse({
      ...minimalPlan,
      openQuestions: [
        { id: "q1", question: "Explicit?", requiredForExecution: true },
        "Plain string question",
      ],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0]?.requiredForExecution).toBe(true);
    expect(result.openQuestions[1]?.question).toBe("Plain string question");
  });

  it("rejects confidence above 1", () => {
    expect(PlanSchema.safeParse({ ...minimalPlan, confidence: 1.1 }).success).toBe(false);
  });

  it("rejects confidence below 0", () => {
    expect(PlanSchema.safeParse({ ...minimalPlan, confidence: -0.1 }).success).toBe(false);
  });

  it("accepts confidence boundary values 0 and 1", () => {
    expect(PlanSchema.parse({ ...minimalPlan, confidence: 0 }).confidence).toBe(0);
    expect(PlanSchema.parse({ ...minimalPlan, confidence: 1 }).confidence).toBe(1);
  });

  it("rejects a zero planVersion (must be positive)", () => {
    expect(PlanSchema.safeParse({ ...minimalPlan, planVersion: 0 }).success).toBe(false);
  });

  it("rejects a plan missing testPlan", () => {
    const { testPlan, ...rest } = minimalPlan;
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });
});
