import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OpenQuestionSchema, PlanStepSchema, PlanSchema } from "../../src/schemas/plan.js";

describe("OpenQuestionSchema", () => {
  it("accepts the object form as-is", () => {
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

  it("defaults requiredForExecution to false via .catch() when it is missing/invalid", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Should we use Postgres?",
      requiredForExecution: "not-a-boolean",
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain-string question, falling back to id 'q1' when there is no path context", () => {
    const result = OpenQuestionSchema.parse("Should we use Postgres?");
    expect(result.question).toBe("Should we use Postgres?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toBe("q1");
  });

  it("derives the id from the element's path when parsed inside an array", () => {
    const result = z.array(OpenQuestionSchema).parse(["First?", "Second?"]);
    expect(result[0].id).toBe("q0");
    expect(result[1].id).toBe("q1");
  });
});

describe("PlanStepSchema", () => {
  it("accepts a valid step", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Do it", description: "details" });
    expect(result.success).toBe(true);
  });

  it("rejects a step missing a required field", () => {
    const result = PlanStepSchema.safeParse({ id: "s1", title: "Do it" });
    expect(result.success).toBe(false);
  });
});

describe("PlanSchema", () => {
  function makeValid(overrides: Record<string, unknown> = {}) {
    return {
      planVersion: 1,
      summary: "Summary",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step", description: "desc" }],
      testPlan: "Run tests",
      confidence: 0.9,
      ...overrides,
    };
  }

  it("parses a minimal valid plan and defaults requirementsTraceability to ''", () => {
    const result = PlanSchema.parse(makeValid());
    expect(result.requirementsTraceability).toBe("");
  });

  it("accepts an explicit requirementsTraceability", () => {
    const result = PlanSchema.parse(makeValid({ requirementsTraceability: "Traces to REQ-1" }));
    expect(result.requirementsTraceability).toBe("Traces to REQ-1");
  });

  it("normalizes FlexString assumptions/risks from plain strings", () => {
    const result = PlanSchema.parse(
      makeValid({ assumptions: ["Plain assumption"], risks: ["Plain risk"] }),
    );
    expect(result.assumptions).toEqual(["Plain assumption"]);
    expect(result.risks).toEqual(["Plain risk"]);
  });

  it("normalizes FlexString assumptions/risks from { description } / { text } objects", () => {
    const result = PlanSchema.parse(
      makeValid({
        assumptions: [{ description: "Object-form assumption" }],
        risks: [{ text: "Object-form risk via text" }],
      }),
    );
    expect(result.assumptions).toEqual(["Object-form assumption"]);
    expect(result.risks).toEqual(["Object-form risk via text"]);
  });

  it("normalizes FlexString risks/assumptions from their dedicated { risk } / { assumption } keys", () => {
    const result = PlanSchema.parse(
      makeValid({
        assumptions: [{ assumption: "Keyed assumption" }],
        risks: [{ risk: "Keyed risk" }],
      }),
    );
    expect(result.assumptions).toEqual(["Keyed assumption"]);
    expect(result.risks).toEqual(["Keyed risk"]);
  });

  it("falls back to an empty string for an unrecognized FlexString shape", () => {
    const result = PlanSchema.parse(
      makeValid({ assumptions: [{ unexpectedShape: true }], risks: [42] }),
    );
    expect(result.assumptions).toEqual([""]);
    expect(result.risks).toEqual([""]);
  });

  it("normalizes plain-string open questions within the plan", () => {
    const result = PlanSchema.parse(
      makeValid({ openQuestions: ["Should we use OAuth?"] }),
    );
    expect(result.openQuestions[0].question).toBe("Should we use OAuth?");
    expect(result.openQuestions[0].requiredForExecution).toBe(false);
  });

  it("rejects a non-positive planVersion", () => {
    const result = PlanSchema.safeParse(makeValid({ planVersion: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects a confidence value outside [0, 1]", () => {
    const result = PlanSchema.safeParse(makeValid({ confidence: 1.1 }));
    expect(result.success).toBe(false);
  });
});
