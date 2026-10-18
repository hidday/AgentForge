import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("parses an object-shaped open question as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which DB?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false via .catch() when it is missing or malformed", () => {
    const result = OpenQuestionSchema.parse({ id: "q1", question: "Which DB?" });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain-string open question into the object shape with requiredForExecution: false", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.startsWith("q")).toBe(true);
  });

  it("normalizes multiple plain-string open questions within a full Plan, each getting an id", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "A plan",
      assumptions: [],
      openQuestions: ["First question?", "Second question?"],
      risks: [],
      steps: [],
      testPlan: "Run tests",
      confidence: 0.5,
    });

    expect(plan.openQuestions).toHaveLength(2);
    expect(plan.openQuestions[0]).toMatchObject({
      question: "First question?",
      requiredForExecution: false,
    });
    expect(plan.openQuestions[1]).toMatchObject({
      question: "Second question?",
      requiredForExecution: false,
    });
    // Each normalized string question gets its own id.
    expect(plan.openQuestions[0]!.id).not.toBe(plan.openQuestions[1]!.id);
  });
});

describe("PlanSchema FlexString fields (assumptions / risks)", () => {
  it("accepts plain strings for assumptions and risks", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "A plan",
      assumptions: ["Assumes staging exists"],
      openQuestions: [],
      risks: ["Could break downstream"],
      steps: [],
      testPlan: "Run tests",
      confidence: 0.5,
    });
    expect(plan.assumptions).toEqual(["Assumes staging exists"]);
    expect(plan.risks).toEqual(["Could break downstream"]);
  });

  it("coerces object-shaped risk/assumption entries to their inner string field", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "A plan",
      assumptions: [{ assumption: "Assumes Node 22" }],
      openQuestions: [],
      risks: [{ risk: "Flaky network in CI" }],
      steps: [],
      testPlan: "Run tests",
      confidence: 0.5,
    });
    expect(plan.assumptions).toEqual(["Assumes Node 22"]);
    expect(plan.risks).toEqual(["Flaky network in CI"]);
  });

  it("falls back to an empty string for a risk/assumption entry with no recognizable shape", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "A plan",
      assumptions: [{ unexpected: "shape" }],
      openQuestions: [],
      risks: [12345],
      steps: [],
      testPlan: "Run tests",
      confidence: 0.5,
    });
    expect(plan.assumptions).toEqual([""]);
    expect(plan.risks).toEqual([""]);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const plan = PlanSchema.parse({
      planVersion: 1,
      summary: "A plan",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "Run tests",
      confidence: 0.5,
    });
    expect(plan.requirementsTraceability).toBe("");
  });
});
