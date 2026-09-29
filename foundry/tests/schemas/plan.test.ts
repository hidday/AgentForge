import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema, PlanStepSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("parses the object form unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Is this in scope?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Is this in scope?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when it fails validation in object form", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Is this in scope?",
      requiredForExecution: "yes",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should we migrate the DB first?");
    expect(result).toEqual({
      id: "q1",
      question: "Should we migrate the DB first?",
      requiredForExecution: false,
    });
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    const step = { id: "s1", title: "Do the thing", description: "Details here" };
    expect(PlanStepSchema.parse(step)).toEqual(step);
  });

  it("rejects a step missing a required field", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "Do the thing" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  const basePlan = {
    planVersion: 1,
    summary: "Implement the feature",
    assumptions: ["Node 22 is available"],
    openQuestions: [],
    risks: ["Might break CI"],
    steps: [{ id: "s1", title: "Step one", description: "Do it" }],
    testPlan: "Run unit tests",
    confidence: 0.8,
  };

  it("parses a fully valid plan and defaults requirementsTraceability to empty string", () => {
    const result = PlanSchema.parse(basePlan);
    expect(result.requirementsTraceability).toBe("");
    expect(result.summary).toBe("Implement the feature");
  });

  it("accepts an explicit requirementsTraceability value", () => {
    const result = PlanSchema.parse({ ...basePlan, requirementsTraceability: "Covers REQ-1" });
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  it("accepts string-form openQuestions and normalizes them, deriving id from the field path", () => {
    const result = PlanSchema.parse({ ...basePlan, openQuestions: ["Do we need sign-off?"] });
    expect(result.openQuestions).toEqual([
      { id: "qopenQuestions-0", question: "Do we need sign-off?", requiredForExecution: false },
    ]);
  });

  it("normalizes assumptions and risks provided as objects via FlexString variants", () => {
    const result = PlanSchema.parse({
      ...basePlan,
      assumptions: [{ description: "an assumption" }, { text: "another" }],
      risks: [{ risk: "a risk" }, { assumption: "mislabeled risk" }],
    });
    expect(result.assumptions).toEqual(["an assumption", "another"]);
    expect(result.risks).toEqual(["a risk", "mislabeled risk"]);
  });

  it("falls back to an empty string for an unrecognized FlexString shape", () => {
    const result = PlanSchema.parse({ ...basePlan, assumptions: [{ unexpected: "shape" }] });
    expect(result.assumptions).toEqual([""]);
  });

  it("rejects an invalid confidence value outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...basePlan, confidence: 1.5 }).success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...basePlan, planVersion: 0 }).success).toBe(false);
  });

  it("rejects a plan missing a required field", () => {
    const { testPlan: _testPlan, ...missing } = basePlan;
    expect(PlanSchema.safeParse(missing).success).toBe(false);
  });
});
