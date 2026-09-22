import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makePlan,
  makeRun,
  makeTaskBundle,
  mockPlannerPersists,
} from "./testSupport.js";

describe("OrchestratorService.answerQuestions edge cases", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when there is no TaskBundle artifact after CLARIFICATION_PROVIDED", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        }),
      }),
    ]);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");

    // The state transition to Planning happened before the throw.
    expect(store.run.state).toBe(RunState.Planning);
  });

  it("loops back to HumanClarificationNeeded (not Failed) when still-blocking and under the iteration cap", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
    ]);
    // One prior clarification round (below MAX_CLARIFICATION_ITERATIONS = 3).
    store.events.push({
      id: "evt-prior",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still which env?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);

    const loopEvent = [...store.events]
      .reverse()
      .find((e) => e.eventType === (RunEvent.NEEDS_HUMAN_CLARIFICATION as string));
    expect((loopEvent!.payloadJson as { iteration: number }).iteration).toBe(2);
  });

  it("includes prior ResearchedAnswers in the re-plan call when a ResearchedAnswers artifact already exists", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
      makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          answers: [{ questionId: "q0", question: "Q0?", answer: "A0", confidence: "high" }],
          completedAt: "2026-01-01T00:00:00Z",
        },
      }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 2, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [expect.objectContaining({ questionId: "q0" })],
      }),
    );
  });
});
