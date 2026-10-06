import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("parses the full object form unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use Postgres or SQLite?",
      requiredForExecution: true,
    });
    expect(result).toEqual({
      id: "q1",
      question: "Should we use Postgres or SQLite?",
      requiredForExecution: true,
    });
  });

  it("catches an invalid requiredForExecution and falls back to false", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Any blockers?",
      // Not a boolean at all -- z.boolean().catch(false) should swallow this.
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the expected object shape, deriving an id from ctx.path", () => {
    const result = OpenQuestionSchema.parse("Is the API rate limit documented?");
    expect(result.question).toBe("Is the API rate limit documented?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });

  it("normalizes each plain string in an array, with distinct ids derived from their array index path", () => {
    const schema = PlanSchema.shape.openQuestions;
    const result = schema.parse(["First question?", "Second question?"]);
    expect(result).toHaveLength(2);
    expect(result[0]!.question).toBe("First question?");
    expect(result[1]!.question).toBe("Second question?");
    // Distinct paths (array indices) should produce distinct derived ids.
    expect(result[0]!.id).not.toBe(result[1]!.id);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    const result = PlanStepSchema.safeParse({
      id: "step-1",
      title: "Set up schema",
      description: "Add the new table",
    });
    expect(result.success).toBe(true);
  });
});

describe("PlanSchema", () => {
  const baseStep = { id: "step-1", title: "Do it", description: "Details" };
  const validBase = {
    planVersion: 1,
    summary: "A plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [baseStep],
    testPlan: "Run the tests",
    confidence: 0.8,
  };

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validBase);
    expect(result.requirementsTraceability).toBe("");
  });

  it("preserves an explicitly provided requirementsTraceability", () => {
    const result = PlanSchema.parse({
      ...validBase,
      requirementsTraceability: "Covers REQ-1 and REQ-2",
    });
    expect(result.requirementsTraceability).toBe("Covers REQ-1 and REQ-2");
  });

  it("accepts plain strings for assumptions/risks via the FlexString string branch", () => {
    const result = PlanSchema.parse({
      ...validBase,
      assumptions: ["Users are authenticated"],
      risks: ["Rate limiting could be hit"],
    });
    expect(result.assumptions).toEqual(["Users are authenticated"]);
    expect(result.risks).toEqual(["Rate limiting could be hit"]);
  });

  it("coerces { description }, { text }, { risk }, and { assumption } objects via FlexString", () => {
    const result = PlanSchema.parse({
      ...validBase,
      assumptions: [{ description: "desc-form" }, { text: "text-form" }, { assumption: "assumption-form" }],
      risks: [{ risk: "risk-form" }],
    });
    expect(result.assumptions).toEqual(["desc-form", "text-form", "assumption-form"]);
    expect(result.risks).toEqual(["risk-form"]);
  });

  it("falls back to an empty string via FlexString's unknown branch for an unrecognized shape", () => {
    const result = PlanSchema.parse({
      ...validBase,
      assumptions: [{ somethingElse: 123 }],
    });
    expect(result.assumptions).toEqual([""]);
  });

  it("fails when planVersion is not a positive integer", () => {
    const result = PlanSchema.safeParse({ ...validBase, planVersion: 0 });
    expect(result.success).toBe(false);
  });

  it("fails when confidence is outside the 0-1 range", () => {
    const result = PlanSchema.safeParse({ ...validBase, confidence: 1.1 });
    expect(result.success).toBe(false);
  });

  it("normalizes string-form openQuestions within a full plan parse", () => {
    const result = PlanSchema.parse({
      ...validBase,
      openQuestions: ["Which runtime should execute this?"],
    });
    expect(result.openQuestions[0]).toMatchObject({
      question: "Which runtime should execute this?",
      requiredForExecution: false,
    });
  });
});
