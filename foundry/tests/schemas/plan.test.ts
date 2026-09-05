import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step", description: "Do it" }],
    testPlan: "run tests",
    confidence: 0.8,
    ...overrides,
  };
}

describe("OpenQuestionSchema", () => {
  it("passes through a well-formed object unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which env?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which env?", requiredForExecution: true });
  });

  it("normalizes a plain string into an open-question object", () => {
    const result = OpenQuestionSchema.parse("Should we use OAuth2?");
    expect(result.question).toBe("Should we use OAuth2?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });

  it("defaults requiredForExecution to false when it fails validation", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which env?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.summary).toBe("Do the thing");
    expect(result.requirementsTraceability).toBe("");
  });

  it("normalizes a string entry within openQuestions on a full plan", () => {
    const result = PlanSchema.parse(
      validPlan({ openQuestions: ["Which auth method?", { id: "q2", question: "Timeline?" }] }),
    );
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0].question).toBe("Which auth method?");
    expect(result.openQuestions[0].requiredForExecution).toBe(false);
    expect(result.openQuestions[1].id).toBe("q2");
  });

  it("coerces risk/assumption objects and unknown shapes to strings", () => {
    const result = PlanSchema.parse(
      validPlan({
        risks: ["plain risk", { risk: "object risk" }, { description: "desc risk" }, 42],
        assumptions: [{ assumption: "an assumption" }, { text: "a text" }],
      }),
    );
    expect(result.risks).toEqual(["plain risk", "object risk", "desc risk", ""]);
    expect(result.assumptions).toEqual(["an assumption", "a text"]);
  });

  it("rejects a confidence value outside 0-1", () => {
    expect(() => PlanSchema.parse(validPlan({ confidence: 2 }))).toThrow();
  });
});
