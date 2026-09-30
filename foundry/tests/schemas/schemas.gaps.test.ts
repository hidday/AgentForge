import { describe, it, expect } from "vitest";
import { PlanSchema, OpenQuestionSchema, PlanStepSchema } from "../../src/schemas/plan.js";
import {
  PlanRevisionSchema,
  DispositionItemSchema,
  DispositionStatus,
} from "../../src/schemas/planRevision.js";
import { ExecutionReportSchema, CheckResultSchema } from "../../src/schemas/executionReport.js";

function validPlanStep() {
  return { id: "s1", title: "Step 1", description: "Do it" };
}

function baseValidPlan() {
  return {
    planVersion: 1,
    summary: "Summary",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [validPlanStep()],
    testPlan: "Run tests",
    confidence: 0.5,
  };
}

describe("PlanSchema -- OpenQuestionSchema union normalization (gap coverage)", () => {
  it("accepts the object form of an open question as-is", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Is this required?",
      requiredForExecution: true,
    });
    expect(result).toEqual({ id: "q1", question: "Is this required?", requiredForExecution: true });
  });

  it("defaults requiredForExecution via .catch(false) when given an invalid value", () => {
    const result = OpenQuestionSchema.parse({
      id: "q1",
      question: "Is this required?",
      requiredForExecution: "yes" as unknown as boolean,
    });
    expect(result.requiredForExecution).toBe(false);
  });

  it("normalizes a plain string into an OpenQuestion object with a generated id", () => {
    const result = OpenQuestionSchema.parse("What database should we use?");
    expect(result.question).toBe("What database should we use?");
    expect(result.requiredForExecution).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.startsWith("q")).toBe(true);
  });

  it("normalizes string-form open questions inside a full Plan parse", () => {
    const plan = PlanSchema.parse({
      ...baseValidPlan(),
      openQuestions: ["Plain string question one", "Plain string question two"],
    });
    expect(plan.openQuestions).toHaveLength(2);
    for (const q of plan.openQuestions) {
      expect(typeof q.id).toBe("string");
      expect(typeof q.question).toBe("string");
      expect(q.requiredForExecution).toBe(false);
    }
    expect(plan.openQuestions[0]?.question).toBe("Plain string question one");
    expect(plan.openQuestions[1]?.question).toBe("Plain string question two");
  });

  it("rejects an open question that is neither an object nor a string", () => {
    expect(() => OpenQuestionSchema.parse(42)).toThrow();
  });
});

describe("PlanSchema -- FlexString normalization for assumptions/risks", () => {
  it("accepts plain strings for assumptions and risks", () => {
    const plan = PlanSchema.parse({
      ...baseValidPlan(),
      assumptions: ["Plain assumption"],
      risks: ["Plain risk"],
    });
    expect(plan.assumptions).toEqual(["Plain assumption"]);
    expect(plan.risks).toEqual(["Plain risk"]);
  });

  it("extracts .description/.text/.risk/.assumption from object-shaped entries", () => {
    const plan = PlanSchema.parse({
      ...baseValidPlan(),
      assumptions: [{ assumption: "From assumption key" }, { description: "From description key" }],
      risks: [{ risk: "From risk key" }, { text: "From text key" }],
    });
    expect(plan.assumptions).toEqual(["From assumption key", "From description key"]);
    expect(plan.risks).toEqual(["From risk key", "From text key"]);
  });

  it("falls back to an empty string for unrecognized shapes", () => {
    const plan = PlanSchema.parse({
      ...baseValidPlan(),
      assumptions: [{ somethingElse: 123 }],
      risks: [null as unknown as string],
    });
    expect(plan.assumptions).toEqual([""]);
    expect(plan.risks).toEqual([""]);
  });

  it("defaults requirementsTraceability to an empty string when omitted", () => {
    const plan = PlanSchema.parse(baseValidPlan());
    expect(plan.requirementsTraceability).toBe("");
  });

  it("rejects a non-positive planVersion", () => {
    expect(() => PlanSchema.parse({ ...baseValidPlan(), planVersion: 0 })).toThrow();
  });

  it("rejects a confidence outside [0,1]", () => {
    expect(() => PlanSchema.parse({ ...baseValidPlan(), confidence: 1.5 })).toThrow();
  });
});

describe("PlanStepSchema", () => {
  it("parses a valid step", () => {
    expect(PlanStepSchema.parse(validPlanStep())).toEqual(validPlanStep());
  });

  it("rejects a step missing a title", () => {
    const { title: _title, ...rest } = validPlanStep();
    expect(() => PlanStepSchema.parse(rest)).toThrow();
  });
});

describe("DispositionStatus / NormalizedDispositionStatus (gap coverage)", () => {
  it("keeps 'accepted' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "accepted",
      rationale: "Valid",
    });
    expect(result.status).toBe("accepted");
  });

  it("normalizes 'dismissed' as-is", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "dismissed",
      rationale: "Not applicable",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes the synonym 'rejected' to 'dismissed'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "rejected",
      rationale: "Out of scope",
    });
    expect(result.status).toBe("dismissed");
  });

  it("normalizes any other unknown value to 'partially_incorporated'", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_accepted",
      rationale: "Some of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("normalizes the canonical 'partially_incorporated' value too", () => {
    const result = DispositionItemSchema.parse({
      findingId: "f1",
      status: "partially_incorporated",
      rationale: "Some of it",
    });
    expect(result.status).toBe("partially_incorporated");
  });

  it("valid DispositionStatus enum values parse directly", () => {
    expect(DispositionStatus.parse("accepted")).toBe("accepted");
    expect(DispositionStatus.parse("dismissed")).toBe("dismissed");
    expect(DispositionStatus.parse("partially_incorporated")).toBe("partially_incorporated");
    expect(() => DispositionStatus.parse("bogus")).toThrow();
  });
});

describe("PlanRevisionSchema", () => {
  function validRevision() {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "rev-001",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Valid" }],
    };
  }

  it("parses a valid plan revision, normalizing dispositions", () => {
    const result = PlanRevisionSchema.parse(validRevision());
    expect(result.revisedPlanVersion).toBe(2);
    expect(result.dispositions[0]?.status).toBe("accepted");
  });

  it("rejects a non-positive originalPlanVersion", () => {
    expect(() =>
      PlanRevisionSchema.parse({ ...validRevision(), originalPlanVersion: 0 }),
    ).toThrow();
  });

  it("rejects a missing reviewId", () => {
    const { reviewId: _reviewId, ...rest } = validRevision();
    expect(() => PlanRevisionSchema.parse(rest)).toThrow();
  });
});

describe("CheckResultSchema / ExecutionReportSchema status normalization (gap coverage)", () => {
  it("keeps a known status value ('pass') as-is", () => {
    expect(CheckResultSchema.parse({ status: "pass", details: "ok" }).status).toBe("pass");
  });

  it("keeps 'fail' and 'skip' as-is", () => {
    expect(CheckResultSchema.parse({ status: "fail", details: "broke" }).status).toBe("fail");
    expect(CheckResultSchema.parse({ status: "skip", details: "n/a" }).status).toBe("skip");
  });

  it("normalizes an unrecognized status string to 'skip'", () => {
    expect(CheckResultSchema.parse({ status: "unknown-status", details: "?" }).status).toBe(
      "skip",
    );
  });

  it("defaults executionVersion to 1 when omitted", () => {
    const report = ExecutionReportSchema.parse({
      summary: "s",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.5,
      scoreRationale: "fine",
    });
    expect(report.executionVersion).toBe(1);
  });

  it("rejects a score outside [0,1]", () => {
    expect(() =>
      ExecutionReportSchema.parse({
        executionVersion: 1,
        summary: "s",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: false,
        score: 2,
        scoreRationale: "fine",
      }),
    ).toThrow();
  });
});
