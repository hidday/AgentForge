import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the full object form unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: true,
    });
    expect(result).toEqual({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: true,
    });
  });

  it("defaults requiredForExecution to false when it fails validation", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Optional?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into an object with requiredForExecution=false", () => {
    const result = OpenQuestionSchema.parse("Should we use camelCase?");
    expect(result.question).toBe("Should we use camelCase?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanSchema FlexString fields (assumptions/risks)", () => {
  function basePlan(overrides: Record<string, unknown> = {}) {
    return {
      planVersion: 1,
      summary: "summary",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "test plan",
      confidence: 0.5,
      ...overrides,
    };
  }

  it("accepts plain strings for risks and assumptions", () => {
    const result = PlanSchema.parse(
      basePlan({ risks: ["Could break prod"], assumptions: ["Auth is already set up"] }),
    );
    expect(result.risks).toEqual(["Could break prod"]);
    expect(result.assumptions).toEqual(["Auth is already set up"]);
  });

  it("extracts .description from an object-shaped risk/assumption", () => {
    const result = PlanSchema.parse(
      basePlan({ risks: [{ description: "Migration risk" }] }),
    );
    expect(result.risks).toEqual(["Migration risk"]);
  });

  it("extracts .risk from an object-shaped risk", () => {
    const result = PlanSchema.parse(basePlan({ risks: [{ risk: "Data loss" }] }));
    expect(result.risks).toEqual(["Data loss"]);
  });

  it("extracts .assumption from an object-shaped assumption", () => {
    const result = PlanSchema.parse(basePlan({ assumptions: [{ assumption: "DB is Postgres" }] }));
    expect(result.assumptions).toEqual(["DB is Postgres"]);
  });

  it("extracts .text from an object-shaped risk/assumption", () => {
    const result = PlanSchema.parse(basePlan({ risks: [{ text: "Generic risk text" }] }));
    expect(result.risks).toEqual(["Generic risk text"]);
  });

  it("falls back to an empty string for an unrecognized non-string shape", () => {
    const result = PlanSchema.parse(basePlan({ risks: [{ unexpected: true }] }));
    expect(result.risks).toEqual([""]);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(basePlan());
    expect(result.requirementsTraceability).toBe("");
  });
});
