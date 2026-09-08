import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "Do the thing",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "run tests",
    confidence: 0.8,
    ...overrides,
  };
}

describe("plan schema", () => {
  describe("OpenQuestionSchema", () => {
    it("accepts a well-formed object", () => {
      const parsed = OpenQuestionSchema.parse({
        id: "q1",
        question: "What DB?",
        requiredForExecution: true,
      });
      expect(parsed).toEqual({ id: "q1", question: "What DB?", requiredForExecution: true });
    });

    it("defaults requiredForExecution to false when missing/invalid", () => {
      const parsed = OpenQuestionSchema.parse({ id: "q1", question: "What DB?" });
      expect(parsed.requiredForExecution).toBe(false);
    });

    it("normalizes a plain string into an open-question object", () => {
      const parsed = OpenQuestionSchema.parse("What database should we use?");
      expect(parsed.question).toBe("What database should we use?");
      expect(parsed.requiredForExecution).toBe(false);
      expect(parsed.id).toMatch(/^q/);
    });
  });

  describe("PlanSchema", () => {
    it("parses a minimal valid plan", () => {
      const result = PlanSchema.parse(baseInput());
      expect(result.planVersion).toBe(1);
      expect(result.requirementsTraceability).toBe("");
    });

    it("normalizes plain-string open questions embedded in a full plan", () => {
      const result = PlanSchema.parse(baseInput({ openQuestions: ["Which repo?"] }));
      expect(result.openQuestions).toHaveLength(1);
      expect(result.openQuestions[0].question).toBe("Which repo?");
    });

    it("coerces flexible risk/assumption shapes to strings", () => {
      const result = PlanSchema.parse(
        baseInput({
          assumptions: [
            "plain string",
            { description: "obj description" },
            { assumption: "obj assumption" },
          ],
          risks: [{ risk: "obj risk" }, { text: "obj text" }, { unrelated: true }],
        }),
      );
      expect(result.assumptions).toEqual(["plain string", "obj description", "obj assumption"]);
      expect(result.risks).toEqual(["obj risk", "obj text", ""]);
    });

    it("rejects invalid confidence values outside [0, 1]", () => {
      expect(() => PlanSchema.parse(baseInput({ confidence: 1.5 }))).toThrow();
    });
  });
});
