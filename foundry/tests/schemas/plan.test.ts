import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("parses a well-formed object directly", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "What about X?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "What about X?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when invalid via .catch", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "What about X?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should we do X?");
    expect(result.question).toBe("Should we do X?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    const step = { id: "s1", title: "Do the thing", description: "details" };
    expect(PlanStepSchema.parse(step)).toEqual(step);
  });

  it("fails when a required field is missing", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Do the thing" });
    expect(result.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  const validPlan = {
    planVersion: 1,
    summary: "summary text",
    assumptions: ["assumption 1"],
    openQuestions: [{ id: "q1", question: "q?", requiredForExecution: false }],
    risks: ["risk 1"],
    steps: [{ id: "s1", title: "Step 1", description: "desc" }],
    testPlan: "test everything",
    confidence: 0.9,
  };

  it("parses a fully valid plan", () => {
    const parsed = PlanSchema.parse(validPlan);
    expect(parsed.summary).toBe("summary text");
    expect(parsed.requirementsTraceability).toBe("");
  });

  it("defaults requirementsTraceability to empty string when omitted", () => {
    const parsed = PlanSchema.parse(validPlan);
    expect(parsed.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const parsed = PlanSchema.parse({ ...validPlan, requirementsTraceability: "traces to REQ-1" });
    expect(parsed.requirementsTraceability).toBe("traces to REQ-1");
  });

  it("coerces assumptions/risks given as { description } objects (FlexString)", () => {
    const parsed = PlanSchema.parse({
      ...validPlan,
      assumptions: [{ description: "obj assumption" }],
      risks: [{ risk: "obj risk" }],
    });
    expect(parsed.assumptions).toEqual(["obj assumption"]);
    expect(parsed.risks).toEqual(["obj risk"]);
  });

  it("coerces assumptions given as { text } or { assumption } objects (FlexString)", () => {
    const parsed = PlanSchema.parse({
      ...validPlan,
      assumptions: [{ text: "text form" }, { assumption: "assumption form" }],
    });
    expect(parsed.assumptions).toEqual(["text form", "assumption form"]);
  });

  it("falls back to empty string for an unrecognized FlexString shape", () => {
    const parsed = PlanSchema.parse({
      ...validPlan,
      risks: [{ somethingElse: true }],
    });
    expect(parsed.risks).toEqual([""]);
  });

  it("accepts openQuestions expressed as plain strings", () => {
    const parsed = PlanSchema.parse({ ...validPlan, openQuestions: ["Plain question?"] });
    expect(parsed.openQuestions[0]?.question).toBe("Plain question?");
  });

  it("fails when confidence is out of the 0-1 range", () => {
    const result = PlanSchema.safeParse({ ...validPlan, confidence: 2 });
    expect(result.success).toBe(false);
  });

  it("fails when planVersion is not a positive integer", () => {
    const result = PlanSchema.safeParse({ ...validPlan, planVersion: 0 });
    expect(result.success).toBe(false);
  });
});
