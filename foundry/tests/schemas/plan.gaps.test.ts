import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    planVersion: 1,
    summary: "Summary",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step", description: "Do it" }],
    testPlan: "Run tests",
    confidence: 0.5,
    ...overrides,
  };
}

describe("OpenQuestionSchema", () => {
  it("normalizes a plain-string question into the object shape", () => {
    const result = OpenQuestionSchema.safeParse("Should we use Postgres?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("Should we use Postgres?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(result.data.id.startsWith("q")).toBe(true);
    }
  });

  it("accepts the object form with requiredForExecution set", () => {
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

  it("defaults requiredForExecution to false via .catch when given a non-boolean", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Q?",
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredForExecution).toBe(false);
    }
  });
});

describe("PlanSchema with string-form openQuestions", () => {
  it("accepts a plan whose openQuestions are plain strings", () => {
    const result = PlanSchema.safeParse(
      validPlan({ openQuestions: ["Plain question one", "Plain question two"] }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions).toHaveLength(2);
      expect(result.data.openQuestions[0].question).toBe("Plain question one");
      expect(result.data.openQuestions[0].requiredForExecution).toBe(false);
    }
  });

  it("accepts a plan mixing string and object openQuestions", () => {
    const result = PlanSchema.safeParse(
      validPlan({
        openQuestions: [
          "Plain question",
          { id: "q2", question: "Structured question", requiredForExecution: true },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions[0].question).toBe("Plain question");
      expect(result.data.openQuestions[1].requiredForExecution).toBe(true);
    }
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirementsTraceability).toBe("");
    }
  });

  it("rejects a plan with confidence outside 0-1", () => {
    expect(PlanSchema.safeParse(validPlan({ confidence: 1.5 })).success).toBe(false);
  });
});
