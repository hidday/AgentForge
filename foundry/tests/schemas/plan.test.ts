import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema, PlanStepSchema } from "../../src/schemas/plan.js";

const baseStep = { id: "s1", title: "Step 1", description: "Do it" };

const validPlan = {
  planVersion: 1,
  summary: "Summary",
  assumptions: ["We have a database."],
  openQuestions: [],
  risks: ["Could break prod."],
  steps: [baseStep],
  testPlan: "Run the suite",
  confidence: 0.7,
};

describe("OpenQuestionSchema", () => {
  it("accepts and passes through a well-formed object form", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "q1", question: "Which DB?", requiredForExecution: true });
    }
  });

  it("catches an invalid requiredForExecution value and defaults it to false", () => {
    const result = OpenQuestionSchema.safeParse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: "yes please",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredForExecution).toBe(false);
    }
  });

  it("normalizes a bare string into a question object with a generated id", () => {
    const result = OpenQuestionSchema.safeParse("What auth provider should we use?");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe("What auth provider should we use?");
      expect(result.data.requiredForExecution).toBe(false);
      expect(result.data.id).toMatch(/^q/);
    }
  });

  it("rejects a value that matches neither union member (e.g. a number)", () => {
    const result = OpenQuestionSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

describe("PlanStepSchema", () => {
  it("accepts a well-formed step", () => {
    expect(PlanStepSchema.safeParse(baseStep).success).toBe(true);
  });

  it("rejects a step missing a description", () => {
    const { description: _description, ...rest } = baseStep;
    expect(PlanStepSchema.safeParse(rest).success).toBe(false);
  });
});

describe("PlanSchema — FlexString normalization (assumptions/risks)", () => {
  it("accepts a plain string assumption/risk", () => {
    const result = PlanSchema.safeParse({ ...validPlan, assumptions: ["plain string"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assumptions).toEqual(["plain string"]);
  });

  it("coerces a { description } object to its description string", () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      risks: [{ description: "Might leak PII" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.risks).toEqual(["Might leak PII"]);
  });

  it("coerces a { text } object to its text string", () => {
    const result = PlanSchema.safeParse({ ...validPlan, assumptions: [{ text: "Has Redis" }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assumptions).toEqual(["Has Redis"]);
  });

  it("coerces a { risk } object to its risk string", () => {
    const result = PlanSchema.safeParse({ ...validPlan, risks: [{ risk: "Downtime" }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.risks).toEqual(["Downtime"]);
  });

  it("coerces a { assumption } object to its assumption string", () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      assumptions: [{ assumption: "CI is green" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assumptions).toEqual(["CI is green"]);
  });

  it("falls back to an empty string for a shape matching none of the known forms", () => {
    const result = PlanSchema.safeParse({ ...validPlan, risks: [{ unexpected: "shape" }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.risks).toEqual([""]);
  });

  // Note: FlexString's final union member is
  // `z.unknown().transform((v) => (typeof v === "string" ? v : ""))`. Its
  // `typeof v === "string"` branch can never be true in practice: this
  // fallback is only reached once the first union member, `z.string()`, has
  // already failed to match -- and a real string always matches `z.string()`.
  // So by the time this fallback transform runs, `v` can never itself be a
  // string. That "true" branch is defensive dead code, not something we can
  // reach without bypassing the union ordering, so we don't force it here.
});

describe("PlanSchema — requirementsTraceability default", () => {
  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const { requirementsTraceability: _rt, ...rest } = validPlan as Record<string, unknown>;
    const result = PlanSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requirementsTraceability).toBe("");
  });

  it("keeps an explicitly provided requirementsTraceability value", () => {
    const result = PlanSchema.safeParse({ ...validPlan, requirementsTraceability: "REQ-1 -> step1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requirementsTraceability).toBe("REQ-1 -> step1");
  });
});

describe("PlanSchema — overall validation", () => {
  it("accepts a fully valid plan", () => {
    expect(PlanSchema.safeParse(validPlan).success).toBe(true);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...validPlan, confidence: 1.5 }).success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan, planVersion: 0 }).success).toBe(false);
  });
});
