import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";

function makeValidPlan() {
  return {
    planVersion: 1,
    summary: "Add a health-check endpoint.",
    assumptions: ["The service already exposes an HTTP server."],
    openQuestions: [{ id: "q1", question: "Which port?", requiredForExecution: true }],
    risks: ["Might conflict with an existing route."],
    steps: [{ id: "s1", title: "Add route", description: "Add GET /health." }],
    testPlan: "Add an integration test that hits /health.",
    confidence: 0.8,
  };
}

describe("PlanStepSchema", () => {
  it("requires id, title and description", () => {
    expect(PlanStepSchema.safeParse({ id: "s1", title: "t", description: "d" }).success).toBe(
      true,
    );
    expect(PlanStepSchema.safeParse({ id: "s1", title: "t" }).success).toBe(false);
  });
});

describe("OpenQuestionSchema", () => {
  it("accepts the full object form and preserves its fields", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which port?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Which port?", requiredForExecution: true });
  });

  it("normalizes a plain string into {id, question, requiredForExecution: false}", () => {
    const result = OpenQuestionSchema.parse("What timezone should we use?");
    expect(result.question).toBe("What timezone should we use?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("catches an invalid requiredForExecution (non-boolean) to false in the object form", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Which port?",
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("rejects a value that is neither a valid object form nor a string", () => {
    expect(OpenQuestionSchema.safeParse(42).success).toBe(false);
    expect(OpenQuestionSchema.safeParse(null).success).toBe(false);
  });
});

describe("PlanSchema", () => {
  it("parses a fully valid plan", () => {
    const result = PlanSchema.safeParse(makeValidPlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.planVersion).toBe(1);
      expect(result.data.requirementsTraceability).toBe("");
    }
  });

  it("defaults requirementsTraceability to '' when omitted", () => {
    const plan = makeValidPlan() as Record<string, unknown>;
    delete plan.requirementsTraceability;

    const result = PlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirementsTraceability).toBe("");
    }
  });

  it("keeps an explicit requirementsTraceability value", () => {
    const plan = { ...makeValidPlan(), requirementsTraceability: "Covers REQ-12 and REQ-13." };
    const result = PlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirementsTraceability).toBe("Covers REQ-12 and REQ-13.");
    }
  });

  it("accepts openQuestions mixing plain strings and full objects", () => {
    const plan = {
      ...makeValidPlan(),
      openQuestions: ["A bare string question?", { id: "q2", question: "Object question?" }],
    };
    const result = PlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openQuestions).toHaveLength(2);
      expect(result.data.openQuestions[0]!.question).toBe("A bare string question?");
      expect(result.data.openQuestions[1]!.requiredForExecution).toBe(false);
    }
  });

  describe("FlexString coercion for assumptions/risks", () => {
    it("keeps plain strings as-is", () => {
      const plan = { ...makeValidPlan(), assumptions: ["plain assumption"] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual(["plain assumption"]);
    });

    it("extracts .description from an object shaped { description }", () => {
      const plan = { ...makeValidPlan(), assumptions: [{ description: "from description" }] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual(["from description"]);
    });

    it("extracts .text from an object shaped { text }", () => {
      const plan = { ...makeValidPlan(), risks: [{ text: "from text" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual(["from text"]);
    });

    it("extracts .risk from an object shaped { risk }", () => {
      const plan = { ...makeValidPlan(), risks: [{ risk: "from risk field" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual(["from risk field"]);
    });

    it("extracts .assumption from an object shaped { assumption }", () => {
      const plan = { ...makeValidPlan(), assumptions: [{ assumption: "from assumption field" }] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual(["from assumption field"]);
    });

    it("falls back to '' for a shape matching none of the known fields", () => {
      const plan = { ...makeValidPlan(), risks: [{ unexpectedField: "nope" }] };
      const result = PlanSchema.parse(plan);
      expect(result.risks).toEqual([""]);
    });

    it("falls back to '' for a non-string, non-object value (e.g. a number)", () => {
      const plan = { ...makeValidPlan(), assumptions: [42] };
      const result = PlanSchema.parse(plan);
      expect(result.assumptions).toEqual([""]);
    });
  });

  it("rejects planVersion 0 (not positive)", () => {
    const plan = { ...makeValidPlan(), planVersion: 0 };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a non-integer planVersion", () => {
    const plan = { ...makeValidPlan(), planVersion: 1.5 };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("accepts confidence at the 0 and 1 boundaries", () => {
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: 0 }).success).toBe(true);
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: 1 }).success).toBe(true);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: -0.1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...makeValidPlan(), confidence: 1.1 }).success).toBe(false);
  });

  it("rejects a plan missing a required field (summary)", () => {
    const plan = makeValidPlan() as Record<string, unknown>;
    delete plan.summary;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a plan with an invalid step (missing description)", () => {
    const plan = { ...makeValidPlan(), steps: [{ id: "s1", title: "t" }] };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});
