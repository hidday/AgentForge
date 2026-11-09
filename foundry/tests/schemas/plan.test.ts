import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Implement the feature",
    assumptions: ["Postgres is already configured"],
    openQuestions: [{ id: "q1", question: "Use OAuth2?", requiredForExecution: true }],
    risks: ["Might break existing tests"],
    steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
    testPlan: "Run the test suite",
    confidence: 0.85,
  };
}

describe("OpenQuestionSchema", () => {
  it("parses an object-form open question as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Should we use Postgres?", requiredForExecution: true });
  });

  it("transforms a plain string into an object with an auto-generated id and requiredForExecution=false", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });

  it("catches an invalid requiredForExecution value and falls back to false", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Q?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("rejects an object-form open question missing the required question field", () => {
    const result = OpenQuestionSchema.safeParse({ id: "q1" });
    expect(result.success).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    expect(PlanStepSchema.parse({ id: "s1", title: "T", description: "D" })).toEqual({
      id: "s1",
      title: "T",
      description: "D",
    });
  });

  it("rejects a step missing a required field", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "T" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.planVersion).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.confidence).toBe(0.85);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const result = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Covers REQ-1" });
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  it("normalizes plain-string openQuestions mixed with object-form ones", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      openQuestions: ["Plain string question?", { id: "q2", question: "Object question?", requiredForExecution: false }],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0].question).toBe("Plain string question?");
    expect(result.openQuestions[1].question).toBe("Object question?");
  });

  it("accepts risks/assumptions as plain strings via the FlexString union", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: ["Plain risk"], assumptions: ["Plain assumption"] });
    expect(result.risks).toEqual(["Plain risk"]);
    expect(result.assumptions).toEqual(["Plain assumption"]);
  });

  it("coerces a { description } object risk/assumption via the FlexString union", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [{ description: "Risk from an object" }],
      assumptions: [{ description: "Assumption from an object" }],
    });
    expect(result.risks).toEqual(["Risk from an object"]);
    expect(result.assumptions).toEqual(["Assumption from an object"]);
  });

  it("coerces { text }, { risk }, and { assumption } shaped objects via the FlexString union", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [{ risk: "Risk via risk field" }],
      assumptions: [{ assumption: "Assumption via assumption field" }],
      testPlan: "Run tests",
    });
    expect(result.risks).toEqual(["Risk via risk field"]);
    expect(result.assumptions).toEqual(["Assumption via assumption field"]);
  });

  it("falls back to an empty string for a FlexString value that matches none of the known shapes", () => {
    const result = PlanSchema.parse({ ...validPlan(), risks: [{ unexpectedShape: true }] });
    expect(result.risks).toEqual([""]);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), planVersion: 0 }).success).toBe(false);
  });

  it("rejects a confidence outside the 0-1 range", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.5 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: -0.1 }).success).toBe(false);
  });

  it("rejects a plan missing required steps", () => {
    const { steps: _steps, ...withoutSteps } = validPlan();
    expect(PlanSchema.safeParse(withoutSteps).success).toBe(false);
  });
});
