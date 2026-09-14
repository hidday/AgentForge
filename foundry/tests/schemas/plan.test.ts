import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function makeValidPlan() {
  return {
    planVersion: 1,
    summary: "Implement feature X",
    assumptions: ["The DB is already migrated"],
    openQuestions: [],
    risks: ["Might break Y"],
    steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
    testPlan: "Run the unit tests",
    confidence: 0.8,
  };
}

describe("PlanSchema", () => {
  it("parses a well-formed plan", () => {
    const plan = makeValidPlan();
    const result = PlanSchema.parse(plan);
    expect(result.planVersion).toBe(1);
    expect(result.requirementsTraceability).toBe("");
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const plan = makeValidPlan();
    const result = PlanSchema.parse(plan);
    expect(result.requirementsTraceability).toBe("");
  });

  it("keeps an explicit requirementsTraceability value", () => {
    const plan = { ...makeValidPlan(), requirementsTraceability: "Covers REQ-1" };
    const result = PlanSchema.parse(plan);
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  it("rejects a non-positive planVersion", () => {
    const plan = { ...makeValidPlan(), planVersion: 0 };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: 1.1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: -0.1 }).success).toBe(false);
  });

  describe("openQuestions normalization", () => {
    it("accepts a well-formed object question as-is", () => {
      const q = { id: "q1", question: "What auth scheme?", requiredForExecution: true };
      const result = OpenQuestionSchema.parse(q);
      expect(result).toEqual(q);
    });

    it("normalizes a plain string question into an object with a generated id", () => {
      const result = OpenQuestionSchema.parse("What auth scheme?");
      expect(result.question).toBe("What auth scheme?");
      expect(result.requiredForExecution).toBe(false);
      expect(result.id.startsWith("q")).toBe(true);
    });

    it("catches an invalid requiredForExecution and defaults it to false", () => {
      const result = OpenQuestionSchema.parse({
        id: "q1",
        question: "What auth scheme?",
        requiredForExecution: "yes" as unknown as boolean,
      });
      expect(result.requiredForExecution).toBe(false);
    });

    it("normalizes string questions inside a full plan parse", () => {
      const plan = {
        ...makeValidPlan(),
        openQuestions: ["Should we support OAuth?", { id: "q2", question: "Which DB?", requiredForExecution: true }],
      };
      const result = PlanSchema.parse(plan);
      expect(result.openQuestions).toHaveLength(2);
      expect(result.openQuestions[0].question).toBe("Should we support OAuth?");
      expect(result.openQuestions[0].requiredForExecution).toBe(false);
      expect(result.openQuestions[1]).toEqual({
        id: "q2",
        question: "Which DB?",
        requiredForExecution: true,
      });
    });
  });

  describe("FlexString coercion for assumptions/risks", () => {
    it("accepts plain strings", () => {
      const plan = { ...makeValidPlan(), assumptions: ["a plain assumption"] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual(["a plain assumption"]);
    });

    it("extracts .description from an object risk", () => {
      const plan = { ...makeValidPlan(), risks: [{ description: "risk via description" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual(["risk via description"]);
    });

    it("extracts .text from an object risk", () => {
      const plan = { ...makeValidPlan(), risks: [{ text: "risk via text" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual(["risk via text"]);
    });

    it("extracts .risk from an object risk", () => {
      const plan = { ...makeValidPlan(), risks: [{ risk: "risk via risk field" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual(["risk via risk field"]);
    });

    it("extracts .assumption from an object assumption", () => {
      const plan = { ...makeValidPlan(), assumptions: [{ assumption: "assumption via assumption field" }] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual(["assumption via assumption field"]);
    });

    it("falls back to an empty string for an unrecognized shape", () => {
      const plan = { ...makeValidPlan(), risks: [{ unexpected: 123 }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual([""]);
    });

    it("falls back to an empty string for a bare number", () => {
      const plan = { ...makeValidPlan(), risks: [42] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual([""]);
    });
  });

  it("rejects a step missing a required field", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Step 1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "description")).toBe(true);
    }
  });
});
