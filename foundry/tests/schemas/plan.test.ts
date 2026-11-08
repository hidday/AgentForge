import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("passes through a well-formed open question object unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we strip unknown fields?",
      requiredForExecution: true,
    });
    expect(result).toEqual({
      id: "q1",
      question: "Should we strip unknown fields?",
      requiredForExecution: true,
    });
  });

  it("normalizes a plain string open question into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should validation strip unknown fields?");
    expect(result.question).toBe("Should validation strip unknown fields?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe("PlanSchema", () => {
  it("accepts a plan whose openQuestions mix object and plain-string forms", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "Add validation middleware",
      assumptions: ["Fastify is already used"],
      openQuestions: [
        { id: "q1", question: "Strip or reject?", requiredForExecution: false },
        "Should this run before auth middleware?",
      ],
      risks: ["Extra fields may be rejected"],
      steps: [{ id: "s1", title: "Create middleware", description: "Add validateBody helper" }],
      testPlan: "Test valid and invalid payloads",
      confidence: 0.8,
    });

    expect(plan.openQuestions).toHaveLength(2);
    expect(plan.openQuestions[0]?.question).toBe("Strip or reject?");
    expect(plan.openQuestions[1]?.question).toBe("Should this run before auth middleware?");
    expect(plan.openQuestions[1]?.requiredForExecution).toBe(false);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "Minimal plan",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "n/a",
      confidence: 0.5,
    });
    expect(plan.requirementsTraceability).toBe("");
  });
});
