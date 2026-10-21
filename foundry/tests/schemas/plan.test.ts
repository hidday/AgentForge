import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the object form as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which DB?", requiredForExecution: true });
  });

  it("defaults requiredForExecution to false when it fails validation (catch)", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which DB?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("transforms a plain string into an object with a generated id", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q/);
  });
});

describe("PlanStepSchema", () => {
  it("requires id, title, and description", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Step", description: "Desc" });
    expect(result.success).toBe(true);
  });

  it("rejects a step missing a required field", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Step" });
    expect(result.success).toBe(false);
  });
});

describe("PlanSchema / FlexString coercion", () => {
  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      planVersion: 1,
      summary: "A plan",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step", description: "Desc" }],
      testPlan: "Run tests",
      confidence: 0.8,
      ...overrides,
    };
  }

  it("parses a fully well-formed plan and defaults requirementsTraceability to an empty string", () => {
    const result = PlanSchema.parse(baseInput());
    expect(result.requirementsTraceability).toBe("");
  });

  it("coerces plain string risks/assumptions as-is", () => {
    const result = PlanSchema.parse(baseInput({ risks: ["Risk A"], assumptions: ["Assume B"] }));
    expect(result.risks).toEqual(["Risk A"]);
    expect(result.assumptions).toEqual(["Assume B"]);
  });

  it("coerces {description}, {text}, {risk}, and {assumption} object shapes to their string", () => {
    const result = PlanSchema.parse(
      baseInput({
        risks: [{ risk: "Object risk" }, { description: "Fallback via description" }],
        assumptions: [{ assumption: "Object assumption" }, { text: "Fallback via text" }],
      }),
    );
    expect(result.risks).toEqual(["Object risk", "Fallback via description"]);
    expect(result.assumptions).toEqual(["Object assumption", "Fallback via text"]);
  });

  it("falls back to an empty string for an unrecognized risk/assumption shape", () => {
    const result = PlanSchema.parse(baseInput({ risks: [{ unexpected: 42 }] }));
    expect(result.risks).toEqual([""]);
  });

  it("normalizes mixed string and object openQuestions", () => {
    const result = PlanSchema.parse(
      baseInput({
        openQuestions: [
          "Plain question?",
          { id: "q2", question: "Structured question?", requiredForExecution: true },
        ],
      }),
    );
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[0]?.question).toBe("Plain question?");
    expect(result.openQuestions[1]).toEqual({
      id: "q2",
      question: "Structured question?",
      requiredForExecution: true,
    });
  });

  it("rejects a confidence value outside [0, 1]", () => {
    const result = PlanSchema.safeParse(baseInput({ confidence: 1.5 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanSchema.safeParse(baseInput({ planVersion: 0 }));
    expect(result.success).toBe(false);
  });
});
