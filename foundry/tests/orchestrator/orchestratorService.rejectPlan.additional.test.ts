import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makeTaskBundle,
  makePlanReview,
  makeResearchedAnswers,
} from "./_helpers/fixtures.js";

describe("OrchestratorService.rejectPlan -- additional branches (iterate context injection)", () => {
  it("mode='iterate' (default) loads previousPlan, humanAnswers, researchedAnswers, and planReviewFindings via loadReplanContext", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);

    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    artifactRepo.seed("HumanAnswers", {
      answers: [{ questionId: "q1", answer: "yes" }],
      submittedAt: new Date().toISOString(),
    });
    artifactRepo.seed("ResearchedAnswers", makeResearchedAnswers());
    artifactRepo.seed(
      "PlanReview",
      makePlanReview({
        summary: "Needs a bit more detail",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing case", details: "detail" },
        ],
      }),
    );

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Plan", newPlan);
      return newPlan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Use OAuth2", "api", "iterate");

    // Find the second plannerAgent.run call (the re-plan after rejection).
    const rePlanCall = plannerAgent.run.mock.calls.find(
      (call) => (call[2] as { planVersionOverride?: number })?.planVersionOverride === 3,
    );
    expect(rePlanCall).toBeDefined();
    expect(rePlanCall![2]).toMatchObject({
      previousPlan: expect.objectContaining({ planVersion: 2 }),
      humanAnswers: [{ questionId: "q1", answer: "yes" }],
      researchedAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "q1" })]),
      planReviewFindings: expect.objectContaining({ summary: "Needs a bit more detail" }),
    });
  });

  it("mode='fresh' skips loadReplanContext (no previousPlan/humanAnswers/researchedAnswers/planReviewFindings injected)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);

    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    artifactRepo.seed("HumanAnswers", {
      answers: [{ questionId: "q1", answer: "yes" }],
      submittedAt: new Date().toISOString(),
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Plan", newPlan);
      return newPlan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Start over entirely", "api", "fresh");

    const rePlanCall = plannerAgent.run.mock.calls.find(
      (call) => (call[2] as { planVersionOverride?: number })?.planVersionOverride === 3,
    );
    expect(rePlanCall).toBeDefined();
    expect(rePlanCall![2]).not.toHaveProperty("previousPlan");
    expect(rePlanCall![2]).not.toHaveProperty("humanAnswers");
    expect(rePlanCall![2]).not.toHaveProperty("researchedAnswers");
    expect(rePlanCall![2]).not.toHaveProperty("planReviewFindings");
    // humanFeedback still comes from the RejectionContext (created in this same call,
    // independent of mode), so it IS present.
    expect(rePlanCall![2]).toMatchObject({
      humanFeedback: { planVersion: 2, feedback: "Start over entirely" },
    });
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));

    const newPlan = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "Reconsider the approach");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
