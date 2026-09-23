import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "Add auth middleware",
    assumptions: ["Fastify is used"],
    openQuestions: [],
    risks: ["Might break existing sessions"],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run the test suite",
    confidence: 0.8,
    ...overrides,
  };
}

describe("PlanSchema", () => {
  it("parses a fully-shaped plan", () => {
    const result = PlanSchema.parse(makeValidPlan());
    expect(result.summary).toBe("Add auth middleware");
    expect(result.requirementsTraceability).toBe("");
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(makeValidPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("keeps an explicit requirementsTraceability value", () => {
    const result = PlanSchema.parse(
      makeValidPlan({ requirementsTraceability: "Covers ENG-1 acceptance criteria" }),
    );
    expect(result.requirementsTraceability).toBe("Covers ENG-1 acceptance criteria");
  });

  describe("openQuestions normalization", () => {
    it("accepts a fully-shaped object openQuestion unchanged", () => {
      const result = OpenQuestionSchema.parse({
        id: "q1",
        question: "Should we support SSO?",
        requiredForExecution: true,
      });
      expect(result).toEqual({
        id: "q1",
        question: "Should we support SSO?",
        requiredForExecution: true,
      });
    });

    it("normalizes a plain-string openQuestion into the object shape", () => {
      const result = OpenQuestionSchema.parse("Should we support SSO?");
      expect(result.question).toBe("Should we support SSO?");
      expect(result.requiredForExecution).toBe(false);
      expect(result.id).toMatch(/^q/);
    });

    it("normalizes plain-string openQuestions inside a full plan parse", () => {
      const result = PlanSchema.parse(
        makeValidPlan({ openQuestions: ["Should we support SSO?", "Which region?"] }),
      );
      expect(result.openQuestions).toHaveLength(2);
      expect(result.openQuestions[0].question).toBe("Should we support SSO?");
      expect(result.openQuestions[0].requiredForExecution).toBe(false);
      expect(result.openQuestions[1].question).toBe("Which region?");
    });

    it("defaults requiredForExecution to false when the model omits it via .catch", () => {
      const result = OpenQuestionSchema.parse({
        id: "q2",
        question: "Missing the required flag",
        requiredForExecution: "not-a-boolean",
      });
      expect(result.requiredForExecution).toBe(false);
    });
  });

  describe("FlexString coercion for assumptions/risks", () => {
    it("accepts plain strings", () => {
      const result = PlanSchema.parse(makeValidPlan({ assumptions: ["plain string"] }));
      expect(result.assumptions).toEqual(["plain string"]);
    });

    it("coerces {assumption: string} objects", () => {
      const result = PlanSchema.parse(
        makeValidPlan({ assumptions: [{ assumption: "coerced assumption" }] }),
      );
      expect(result.assumptions).toEqual(["coerced assumption"]);
    });

    it("coerces {risk: string} objects", () => {
      const result = PlanSchema.parse(makeValidPlan({ risks: [{ risk: "coerced risk" }] }));
      expect(result.risks).toEqual(["coerced risk"]);
    });

    it("coerces {description: string} objects", () => {
      const result = PlanSchema.parse(
        makeValidPlan({ assumptions: [{ description: "coerced description" }] }),
      );
      expect(result.assumptions).toEqual(["coerced description"]);
    });

    it("coerces {text: string} objects", () => {
      const result = PlanSchema.parse(makeValidPlan({ risks: [{ text: "coerced text" }] }));
      expect(result.risks).toEqual(["coerced text"]);
    });

    it("falls back to an empty string for anything else", () => {
      const result = PlanSchema.parse(makeValidPlan({ assumptions: [{ nonsense: 123 }] }));
      expect(result.assumptions).toEqual([""]);
    });
  });
});
