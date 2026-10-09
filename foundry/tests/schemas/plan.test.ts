import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function makeValidPlan() {
  return {
    planVersion: 1,
    summary: "Implement the feature",
    assumptions: ["Postgres is already provisioned"],
    openQuestions: [{ id: "q1", question: "Which auth method?", requiredForExecution: true }],
    risks: ["Might break existing tests"],
    steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
    testPlan: "Run the full suite",
    confidence: 0.8,
  };
}

describe("schemas/plan", () => {
  describe("OpenQuestionSchema", () => {
    it("accepts the full object form as-is", () => {
      const result = OpenQuestionSchema.safeParse({
        id: "q1",
        question: "Should we use OAuth?",
        requiredForExecution: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          id: "q1",
          question: "Should we use OAuth?",
          requiredForExecution: true,
        });
      }
    });

    it("defaults requiredForExecution to false via .catch() when it is missing", () => {
      const result = OpenQuestionSchema.safeParse({
        id: "q1",
        question: "Should we use OAuth?",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.requiredForExecution).toBe(false);
    });

    it("defaults requiredForExecution to false via .catch() when it has the wrong type", () => {
      const result = OpenQuestionSchema.safeParse({
        id: "q1",
        question: "Should we use OAuth?",
        requiredForExecution: "yes",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.requiredForExecution).toBe(false);
    });

    it("transforms a plain string into the expected object shape", () => {
      const result = OpenQuestionSchema.safeParse("What database should we use?");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.question).toBe("What database should we use?");
        expect(result.data.requiredForExecution).toBe(false);
        expect(result.data.id).toMatch(/^q/);
      }
    });

    it("rejects a non-string, non-object value", () => {
      const result = OpenQuestionSchema.safeParse(42);
      expect(result.success).toBe(false);
    });
  });

  describe("PlanStepSchema", () => {
    it("requires id, title, and description", () => {
      expect(PlanStepSchema.safeParse({ id: "s1", title: "T" }).success).toBe(false);
      expect(
        PlanStepSchema.safeParse({ id: "s1", title: "T", description: "D" }).success,
      ).toBe(true);
    });
  });

  describe("PlanSchema FlexString fields (assumptions / risks)", () => {
    it("accepts plain strings", () => {
      const plan = { ...makeValidPlan(), assumptions: ["a plain string"] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.assumptions).toEqual(["a plain string"]);
    });

    it("extracts .description from an object shape", () => {
      const plan = { ...makeValidPlan(), assumptions: [{ description: "from description" }] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.assumptions).toEqual(["from description"]);
    });

    it("extracts .text from an object shape", () => {
      const plan = { ...makeValidPlan(), risks: [{ text: "from text" }] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.risks).toEqual(["from text"]);
    });

    it("extracts .risk from an object shape", () => {
      const plan = { ...makeValidPlan(), risks: [{ risk: "from risk field" }] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.risks).toEqual(["from risk field"]);
    });

    it("extracts .assumption from an object shape", () => {
      const plan = { ...makeValidPlan(), assumptions: [{ assumption: "from assumption field" }] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.assumptions).toEqual(["from assumption field"]);
    });

    it("falls back to an empty string for an object with none of the known keys", () => {
      const plan = { ...makeValidPlan(), risks: [{ unknownKey: "ignored" }] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.risks).toEqual([""]);
    });

    it("falls back to an empty string for a non-string, non-object value", () => {
      const plan = { ...makeValidPlan(), risks: [42] };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.risks).toEqual([""]);
    });
  });

  describe("PlanSchema top-level validation", () => {
    it("accepts a fully valid plan", () => {
      const result = PlanSchema.safeParse(makeValidPlan());
      expect(result.success).toBe(true);
    });

    it("defaults requirementsTraceability to an empty string when omitted", () => {
      const plan = makeValidPlan() as Record<string, unknown>;
      delete plan.requirementsTraceability;
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.requirementsTraceability).toBe("");
    });

    it("rejects a confidence value above 1", () => {
      const plan = { ...makeValidPlan(), confidence: 1.5 };
      expect(PlanSchema.safeParse(plan).success).toBe(false);
    });

    it("rejects a confidence value below 0", () => {
      const plan = { ...makeValidPlan(), confidence: -0.1 };
      expect(PlanSchema.safeParse(plan).success).toBe(false);
    });

    it("rejects a non-positive planVersion", () => {
      const plan = { ...makeValidPlan(), planVersion: 0 };
      expect(PlanSchema.safeParse(plan).success).toBe(false);
    });

    it("rejects a plan missing required fields", () => {
      const plan = makeValidPlan() as Record<string, unknown>;
      delete plan.testPlan;
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "testPlan")).toBe(true);
      }
    });

    it("normalizes a mix of string and object openQuestions entries", () => {
      const plan = {
        ...makeValidPlan(),
        openQuestions: ["Plain question?", { id: "q2", question: "Object question?" }],
      };
      const result = PlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.openQuestions).toHaveLength(2);
        expect(result.data.openQuestions[0].question).toBe("Plain question?");
        expect(result.data.openQuestions[1].question).toBe("Object question?");
      }
    });
  });
});
