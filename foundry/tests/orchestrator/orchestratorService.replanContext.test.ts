/**
 * Covers the re-planning context plumbing that the existing rejectPlan /
 * clarification / answer-researcher suites leave untouched:
 *  - rejectPlan "iterate" mode loading prior Plan / HumanAnswers /
 *    ResearchedAnswers / PlanReview context (loadReplanContext), and the
 *    blocking-questions branch after rejection;
 *  - answerQuestions edge cases (missing artifacts, carried-over researched
 *    answers, a further clarification round below the iteration cap);
 *  - the answer researcher receiving previously submitted human answers.
 */
import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import { createHarness, makePlan, makePlanReview, makeRun } from "./helpers/orchestratorHarness.js";

const researched = {
  summary: "prior research",
  answers: [{ questionId: "q2", question: "Infra?", answer: "AWS", confidence: "medium" }],
  completedAt: "2026-01-01T00:00:00.000Z",
};

const priorPlanReview: PlanReview = makePlanReview({
  summary: "Prior review",
  overallVerdict: "changes_requested",
  findings: [
    { id: "pf1", severity: "important", type: "gap", title: "Gap", details: "Missing tests" },
  ],
});

describe("OrchestratorService.rejectPlan -- iterate-mode context", () => {
  it("feeds the previous plan, answers and plan-review findings into the re-plan", async () => {
    const previousPlan = makePlan({ planVersion: 2, summary: "v2 plan" });
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [
        { type: "Plan", version: 2, payloadJson: previousPlan },
        {
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "Yes" }] },
        },
        { type: "ResearchedAnswers", version: 1, payloadJson: researched },
        { type: "PlanReview", version: 1, payloadJson: priorPlanReview },
      ],
    });

    const run = await h.svc.rejectPlan("run-1", "Too broad", "api", "iterate");

    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({
      priorSkills: [],
      planVersionOverride: 3,
      previousPlan,
      humanFeedback: { planVersion: 2, feedback: "Too broad" },
      humanAnswers: [{ questionId: "q1", answer: "Yes" }],
      researchedAnswers: researched.answers,
      planReviewFindings: { summary: "Prior review", findings: priorPlanReview.findings },
    });
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(run.planVersion).toBe(3);
  });

  it("omits empty prior answers from the re-plan options", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        { type: "HumanAnswers", version: 1, payloadJson: { answers: [] } },
        { type: "ResearchedAnswers", version: 1, payloadJson: { ...researched, answers: [] } },
      ],
    });

    await h.svc.rejectPlan("run-1");

    const opts = h.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("humanAnswers");
    expect(opts).not.toHaveProperty("researchedAnswers");
    expect(opts).not.toHaveProperty("planReviewFindings");
    expect(opts).not.toHaveProperty("humanFeedback");
    expect(opts.previousPlan).toEqual(makePlan());
  });

  it("does not load prior context in fresh mode", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [
        { type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) },
        { type: "PlanReview", version: 1, payloadJson: priorPlanReview },
      ],
    });

    await h.svc.rejectPlan("run-1", "Start over", "api", "fresh");

    const opts = h.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("previousPlan");
    expect(opts).not.toHaveProperty("planReviewFindings");
    expect(opts.humanFeedback).toEqual({ planVersion: 2, feedback: "Start over" });
  });

  it("pauses for clarification when the re-plan has blocking questions", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
      config: {
        plannerOutputs: [
          { openQuestions: [{ id: "qb", question: "Which tenant?", requiredForExecution: true }] },
        ],
      },
    });

    const run = await h.svc.rejectPlan("run-1", "Clarify tenancy");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.PLAN_REJECTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
    expect(h.recordedEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)?.payloadJson).toMatchObject({
      blockingQuestions: [{ id: "qb", question: "Which tenant?" }],
    });
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- additional edge cases", () => {
  const blockingPlan = makePlan({
    planVersion: 1,
    openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
  });

  it("throws when the run has no plan artifact", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.HumanClarificationNeeded }) });

    await expect(
      h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
    expect(h.artifactsOfType("HumanAnswers")).toHaveLength(0);
  });

  it("throws when the TaskBundle artifact is missing after recording answers", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: blockingPlan }],
    });

    await expect(
      h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
    // Answers were persisted and the run moved back to Planning before the failure.
    expect(h.artifactsOfType("HumanAnswers")).toHaveLength(1);
    expect(h.store.run?.state).toBe(RunState.Planning);
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("carries prior researched answers into the re-plan and skips another research pass", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      withResearcher: true,
      artifacts: [
        { type: "Plan", version: 1, payloadJson: blockingPlan },
        { type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } },
        { type: "ResearchedAnswers", version: 1, payloadJson: researched },
      ],
      config: {
        plannerOutputs: [
          { openQuestions: [{ id: "q3", question: "Optional?", requiredForExecution: false }] },
        ],
      },
    });

    const run = await h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({
      humanAnswers: [{ questionId: "q1", answer: "Postgres" }],
      researchedAnswers: researched.answers,
      planVersionOverride: 2,
    });
    expect(h.answerResearcherAgent.run).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("asks for another clarification round while under the iteration cap", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      events: [{ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }],
      artifacts: [
        { type: "Plan", version: 1, payloadJson: blockingPlan },
        { type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } },
      ],
      config: {
        plannerOutputs: [
          { openQuestions: [{ id: "q9", question: "Which region?", requiredForExecution: true }] },
        ],
      },
    });

    const run = await h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.CLARIFICATION_PROVIDED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
    expect(h.recordedEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)?.payloadJson).toEqual({
      from: RunState.PlanReview,
      to: RunState.HumanClarificationNeeded,
      blockingQuestions: [{ id: "q9", question: "Which region?" }],
      iteration: 2,
    });
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("passes submitted human answers to the researcher and the post-research re-plan", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      withResearcher: true,
      artifacts: [
        { type: "Plan", version: 1, payloadJson: blockingPlan },
        { type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } },
      ],
      config: {
        plannerOutputs: [
          {
            openQuestions: [
              { id: "q4", question: "Cache?", requiredForExecution: false },
              { id: "q5", question: "Metrics?", requiredForExecution: false },
            ],
          },
          { openQuestions: [] },
        ],
      },
    });
    const answers = [{ questionId: "q1", answer: "Postgres" }];

    const run = await h.svc.answerQuestions("run-1", answers);

    expect(h.answerResearcherAgent.run).toHaveBeenCalledTimes(1);
    expect(h.answerResearcherAgent.run.mock.calls[0]?.[3]).toEqual({ humanAnswers: answers });
    expect(h.recordedEvent("RESEARCH_COMPLETED")?.payloadJson).toEqual({
      planVersion: 2,
      answeredCount: 2,
      resolvedCount: 1,
      unresolvedCount: 1,
    });
    // Second planner call (post-research) includes both answer sets.
    expect(h.plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(h.plannerAgent.run.mock.calls[1]?.[2]).toMatchObject({
      planVersionOverride: 3,
      humanAnswers: answers,
      researchedAnswers: [
        expect.objectContaining({ questionId: "q4", confidence: "high" }),
        expect.objectContaining({ questionId: "q5", confidence: "unresolved" }),
      ],
    });
    expect(run.planVersion).toBe(3);
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });
});
