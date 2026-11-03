import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("parses the full object form as-is", () => {
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

  it("defaults requiredForExecution to false when invalid via .catch()", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "A question",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("transforms a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Should we strip unknown fields?");
    expect(result.question).toBe("Should we strip unknown fields?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });

  it("derives a positional id from ctx.path when parsing a string inside an array", () => {
    const ArraySchema = OpenQuestionSchema.array();
    const result = ArraySchema.parse(["first question", "second question"]);
    expect(result[0]!.id).toBe("q0");
    expect(result[1]!.id).toBe("q1");
    expect(result[0]!.question).toBe("first question");
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    expect(PlanStepSchema.parse({ id: "s1", title: "Step", description: "Do a thing" })).toEqual({
      id: "s1",
      title: "Step",
      description: "Do a thing",
    });
  });

  it("fails when a required field is missing", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "Step" }).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  function validPlan() {
    return {
      planVersion: 1,
      summary: "Summary",
      assumptions: ["Assumption 1"],
      openQuestions: [],
      risks: ["Risk 1"],
      steps: [{ id: "s1", title: "Step", description: "Do a thing" }],
      testPlan: "Run tests",
      confidence: 0.9,
    };
  }

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability", () => {
    const result = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Maps to req X" });
    expect(result.requirementsTraceability).toBe("Maps to req X");
  });

  it("normalizes assumptions/risks given as plain strings", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: ["plain assumption"],
      risks: ["plain risk"],
    });
    expect(result.assumptions).toEqual(["plain assumption"]);
    expect(result.risks).toEqual(["plain risk"]);
  });

  it("normalizes assumptions/risks given as { description } objects", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ description: "from description field" }],
    });
    expect(result.assumptions).toEqual(["from description field"]);
  });

  it("normalizes risks given as { risk } objects", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [{ risk: "from risk field" }],
    });
    expect(result.risks).toEqual(["from risk field"]);
  });

  it("normalizes assumptions given as { assumption } objects", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      assumptions: [{ assumption: "from assumption field" }],
    });
    expect(result.assumptions).toEqual(["from assumption field"]);
  });

  it("normalizes a FlexString given as a { text } object", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [{ text: "from text field" }],
    });
    expect(result.risks).toEqual(["from text field"]);
  });

  it("falls back to an empty string for an unrecognized non-string shape", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [{ somethingElse: 123 }],
    });
    expect(result.risks).toEqual([""]);
  });

  it("falls back to an empty string for a non-string, non-object primitive", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      risks: [42],
    });
    expect(result.risks).toEqual([""]);
  });

  it("accepts openQuestions mixing object and string forms", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      openQuestions: [
        { id: "q1", question: "Explicit?", requiredForExecution: true },
        "Implicit string question",
      ],
    });
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0]!.id).toBe("q1");
    expect(result.openQuestions[1]!.question).toBe("Implicit string question");
  });

  it.each([0, 1])("accepts the confidence boundary value %i", (confidence) => {
    expect(() => PlanSchema.parse({ ...validPlan(), confidence })).not.toThrow();
  });

  it.each([-0.01, 1.01])("rejects a confidence outside [0,1]: %s", (confidence) => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence }).success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), planVersion: 0 }).success).toBe(false);
  });

  it("fails when steps is missing", () => {
    const { steps: _steps, ...rest } = validPlan();
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });
});
