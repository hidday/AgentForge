import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

function makeValidPlan() {
  return {
    planVersion: 1,
    summary: "Add request validation middleware.",
    requirementsTraceability: "Covers REQ-1.",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
    testPlan: "Run unit tests",
    confidence: 0.9,
  };
}

describe("OpenQuestionSchema", () => {
  it("accepts the well-formed object shape unchanged", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Which auth?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "q1", question: "Which auth?", requiredForExecution: true });
    }
  });

  it("normalizes a plain string into an OpenQuestion object with a generated id", () => {
    // The model sometimes emits openQuestions as bare strings instead of
    // objects; the string-union branch of the schema must synthesize the
    // {id, question, requiredForExecution} shape.
    const result = OpenQuestionSchema.safeParse("What database should we use?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("What database should we use?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(result.data.id).toMatch(/^q/);
    }
  });

  it("synthesizes a positional id (from ctx.path) when a string openQuestion is nested in an array", () => {
    const plan = makeValidPlan();
    plan.openQuestions = ["Should we use OAuth2?", "Should we support SSO?"] as never;

    const result = PlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions).toHaveLength(2);
      expect(result.data.openQuestions[0]).toMatchObject({
        question: "Should we use OAuth2?",
        requiredForExecution: false,
      });
      expect(result.data.openQuestions[0].id).toBe("qopenQuestions-0");
      expect(result.data.openQuestions[1].id).toBe("qopenQuestions-1");
    }
  });
});
