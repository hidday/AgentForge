import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";
import { buildDeps, makeRun, makePlan, makeArtifact } from "./orchestratorServiceTestHelpers.js";

function withPlanAndBundle(
  artifactRepo: { findLatestByType: ReturnType<typeof vi.fn> },
  plan = makePlan({ openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] }),
) {
  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
    if (type === "TaskBundle") {
      return Promise.resolve(
        makeArtifact({
          type: "TaskBundle",
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp/run-1",
              allowedPaths: [],
              protectedPaths: [],
            },
            constraints: {
              requiredChecks: [],
              maxFilesChanged: 50,
              maxDiffLines: 2000,
              forbiddenPatterns: [],
              mustNotTouch: [],
            },
            definitionOfDone: [],
          },
        }),
      );
    }
    return Promise.resolve(null);
  });
}

describe("OrchestratorService.answerQuestions", () => {
  it("throws PolicyError when the run is in neither valid state", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(PolicyError);
  });

  it("throws when there is no plan artifact", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow("No plan artifact found");
  });

  it("rejects an answer with an unrecognised questionId", async () => {
    const { deps, artifactRepo } = buildDeps({}, makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ openQuestions: [] }) }),
    );
    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "bogus", answer: "x" }]),
    ).rejects.toThrow(ValidationError);
  });

  it("records answers without re-planning when AwaitingPlanApproval", async () => {
    const { deps, artifactRepo, dashboardEmitter, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({
        type: "Plan",
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
        }),
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "HumanAnswers" }),
    );
    expect(dashboardEmitter.emitQuestionsAnswered).toHaveBeenCalledWith("run-1", 1);
    expect(plannerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("rejects missing answers to required questions when HumanClarificationNeeded", async () => {
    const { deps, artifactRepo } = buildDeps(
      {},
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    withPlanAndBundle(artifactRepo);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(ValidationError);
  });

  it("re-plans and proceeds to plan review once all required questions are answered", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    withPlanAndBundle(artifactRepo);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("re-pauses for clarification with an incremented iteration count when still blocked", async () => {
    const { deps, artifactRepo, eventRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    withPlanAndBundle(artifactRepo);
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("fails the run once clarification iterations are exhausted", async () => {
    const { deps, artifactRepo, eventRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    withPlanAndBundle(artifactRepo);
    eventRepo.findByRunId.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({
        id: `e${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      })),
    );
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.Failed);
  });

  it("throws when no TaskBundle artifact exists for a HumanClarificationNeeded re-plan", async () => {
    const { deps, artifactRepo } = buildDeps(
      {},
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
            }),
          }),
        );
      }
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow("No TaskBundle artifact found");
  });
});
