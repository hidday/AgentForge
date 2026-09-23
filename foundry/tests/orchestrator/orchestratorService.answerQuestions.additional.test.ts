import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildFullDeps, makeRun, makePlan, makeTaskBundle, makeResearchedAnswers } from "./_helpers/fixtures.js";

describe("OrchestratorService.answerQuestions -- additional branches", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when there is no TaskBundle artifact (HumanClarificationNeeded path)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed(
      "Plan",
      makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("injects prior researched answers into the re-plan call when a ResearchedAnswers artifact exists", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);
    artifactRepo.seed(
      "Plan",
      makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
    );
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    artifactRepo.seed("ResearchedAnswers", makeResearchedAnswers());
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Plan", newPlan);
      return newPlan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "q1" })]),
        planVersionOverride: 2,
      }),
    );
  });

  it("does not inject researchedAnswers when no ResearchedAnswers artifact exists", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run);
    artifactRepo.seed(
      "Plan",
      makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
    );
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockImplementation(async () => {
      artifactRepo.seed("Plan", newPlan);
      return newPlan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ researchedAnswers: expect.anything() }),
    );
  });

  it("re-pauses in HumanClarificationNeeded (with an incremented iteration) when blockers remain and max iterations is not yet reached", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildFullDeps(run);
    artifactRepo.seed(
      "Plan",
      makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
    );
    artifactRepo.seed("TaskBundle", makeTaskBundle());
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    await eventRepo.create({ runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent" });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial answer" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastEvent = eventRepo._events[eventRepo._events.length - 1];
    expect(lastEvent.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(lastEvent.payloadJson).toMatchObject({ iteration: 2 });
  });
});
