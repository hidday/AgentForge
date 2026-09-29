import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the full object form as-is", () => {
    const parsed = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which auth provider?",
      requiredForExecution: true,
    });
    expect(parsed).toEqual({
      id: "q1",
      question: "Which auth provider?",
      requiredForExecution: true,
    });
  });

  it("defaults requiredForExecution to false via .catch() when it's the wrong type", () => {
    const parsed = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which auth provider?",
      requiredForExecution: "not-a-boolean",
    });
    expect(parsed.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into the full object shape", () => {
    const parsed = OpenQuestionSchema.parse("Which auth provider should we use?");
    expect(parsed).toEqual({
      id: expect.stringMatching(/^q/),
      question: "Which auth provider should we use?",
      requiredForExecution: false,
    });
  });
});

describe("PlanSchema", () => {
  function baseFields() {
    return {
      planVersion: 1,
      summary: "Add auth middleware",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
      testPlan: "Run tests",
      confidence: 0.8,
    };
  }

  it("parses a fully valid plan, defaulting requirementsTraceability to an empty string", () => {
    const parsed = PlanSchema.parse(baseFields());
    expect(parsed.requirementsTraceability).toBe("");
  });

  it("normalizes assumptions/risks given as plain strings via FlexString", () => {
    const parsed = PlanSchema.parse({
      ...baseFields(),
      assumptions: ["Users are already authenticated upstream"],
      risks: ["Token rotation could break active sessions"],
    });
    expect(parsed.assumptions).toEqual(["Users are already authenticated upstream"]);
    expect(parsed.risks).toEqual(["Token rotation could break active sessions"]);
  });

  it("normalizes assumptions/risks given as {description}/{risk}/{text}/{assumption} objects", () => {
    const parsed = PlanSchema.parse({
      ...baseFields(),
      assumptions: [{ assumption: "Config is already loaded" }, { text: "generic text form" }],
      risks: [{ risk: "Could break existing sessions" }, { description: "generic description form" }],
    });
    expect(parsed.assumptions).toEqual(["Config is already loaded", "generic text form"]);
    expect(parsed.risks).toEqual(["Could break existing sessions", "generic description form"]);
  });

  it("falls back to an empty string for an assumption/risk that matches none of the FlexString shapes", () => {
    const parsed = PlanSchema.parse({
      ...baseFields(),
      assumptions: [{ unexpectedShape: true }],
      risks: [12345],
    });
    expect(parsed.assumptions).toEqual([""]);
    expect(parsed.risks).toEqual([""]);
  });

  it("rejects a non-positive or non-integer planVersion", () => {
    expect(() => PlanSchema.parse({ ...baseFields(), planVersion: 0 })).toThrow();
    expect(() => PlanSchema.parse({ ...baseFields(), planVersion: 1.5 })).toThrow();
  });

  it("rejects a confidence outside [0, 1]", () => {
    expect(() => PlanSchema.parse({ ...baseFields(), confidence: 1.5 })).toThrow();
    expect(() => PlanSchema.parse({ ...baseFields(), confidence: -0.1 })).toThrow();
  });
});
