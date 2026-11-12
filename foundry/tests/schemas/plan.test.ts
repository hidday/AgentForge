import { describe, it, expect } from "vitest";
import { OpenQuestionSchema, PlanSchema } from "../../src/schemas/plan.js";

function validPlan() {
  return {
    planVersion: 1,
    summary: "Implement login",
    assumptions: ["User has an account"],
    openQuestions: [],
    risks: ["OAuth provider may rate limit"],
    steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
    testPlan: "Run unit tests",
    confidence: 0.8,
  };
}

describe("OpenQuestionSchema", () => {
  it("passes through a well-formed object unchanged", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which provider?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which provider?", requiredForExecution: true });
  });

  it("normalizes a plain string into the object shape", () => {
    const result = OpenQuestionSchema.parse("Which auth provider should we use?");
    expect(result.question).toBe("Which auth provider should we use?");
    expect(result.requiredForExecution).toBe(false);
    expect(result.id).toMatch(/^q.*$/);
  });

  it("falls back requiredForExecution to false when given an invalid type", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which provider?",
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("falls back requiredForExecution to false when the field is missing", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which provider?",
    });
    expect(result.requiredForExecution).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.planVersion).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.confidence).toBe(0.8);
  });

  it("normalizes string-form open questions when nested inside a plan", () => {
    const result = PlanSchema.parse({
      ...validPlan(),
      openQuestions: ["Which region should we deploy to?", "Who approves the budget?"],
    });
    expect(result.openQuestions).toHaveLength(2);
    for (const q of result.openQuestions) {
      expect(q.requiredForExecution).toBe(false);
      expect(typeof q.id).toBe("string");
      expect(q.id.length).toBeGreaterThan(0);
    }
    expect(result.openQuestions[0].question).toBe("Which region should we deploy to?");
    expect(result.openQuestions[1].question).toBe("Who approves the budget?");
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const result = PlanSchema.parse(validPlan());
    expect(result.requirementsTraceability).toBe("");
  });

  it("keeps a provided requirementsTraceability", () => {
    const result = PlanSchema.parse({ ...validPlan(), requirementsTraceability: "Covers REQ-1" });
    expect(result.requirementsTraceability).toBe("Covers REQ-1");
  });

  describe("FlexString fields (assumptions / risks)", () => {
    it("accepts plain strings", () => {
      const result = PlanSchema.parse({ ...validPlan(), risks: ["Plain risk string"] });
      expect(result.risks).toEqual(["Plain risk string"]);
    });

    it("extracts .description from an object", () => {
      const result = PlanSchema.parse({
        ...validPlan(),
        risks: [{ description: "Risk via description field" }],
      });
      expect(result.risks).toEqual(["Risk via description field"]);
    });

    it("extracts .text from an object", () => {
      const result = PlanSchema.parse({
        ...validPlan(),
        assumptions: [{ text: "Assumption via text field" }],
      });
      expect(result.assumptions).toEqual(["Assumption via text field"]);
    });

    it("extracts .risk from an object", () => {
      const result = PlanSchema.parse({
        ...validPlan(),
        risks: [{ risk: "Risk via risk field" }],
      });
      expect(result.risks).toEqual(["Risk via risk field"]);
    });

    it("extracts .assumption from an object", () => {
      const result = PlanSchema.parse({
        ...validPlan(),
        assumptions: [{ assumption: "Assumption via assumption field" }],
      });
      expect(result.assumptions).toEqual(["Assumption via assumption field"]);
    });

    it("falls back to an empty string for an unrecognized shape", () => {
      const result = PlanSchema.parse({
        ...validPlan(),
        risks: [{ somethingElse: 123 }],
      });
      expect(result.risks).toEqual([""]);
    });
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1.1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: -0.1 }).success).toBe(false);
  });

  it("accepts confidence at the boundaries 0 and 1", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 0 }).success).toBe(true);
    expect(PlanSchema.safeParse({ ...validPlan(), confidence: 1 }).success).toBe(true);
  });

  it("rejects a non-positive planVersion", () => {
    expect(PlanSchema.safeParse({ ...validPlan(), planVersion: 0 }).success).toBe(false);
  });

  it("rejects a plan missing required fields", () => {
    const plan = validPlan();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (plan as any).summary;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});
