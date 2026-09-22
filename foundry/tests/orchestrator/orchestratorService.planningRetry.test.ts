import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { RejectionContextPayload } from "../../src/domain/types.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  mockPlannerPersists,
  makePlan,
  makePlanReview,
  makeRun,
} from "./testSupport.js";

describe("OrchestratorService.runPlanning", () => {
  it("re-plans, injects prior context artifacts into plannerAgent.run, and proceeds to plan review when no blockers remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      makeArtifact({
        type: "RejectionContext",
        version: 2,
        payloadJson: {
          planVersion: 2,
          feedback: "Use OAuth2",
          source: "api",
          mode: "iterate",
        } satisfies RejectionContextPayload,
      }),
      makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
      makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
          completedAt: "2026-01-01T00:00:00Z",
        },
      }),
      makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "review summary", findings: [] },
      }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 3, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          expect.objectContaining({ questionId: "q2", answer: "A2" }),
        ],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();

    const clarificationEvent = store.events.find(
      (e) => e.eventType === (RunEvent.NEEDS_HUMAN_CLARIFICATION as string),
    );
    expect(clarificationEvent).toBeDefined();
    expect(
      (clarificationEvent!.payloadJson as { blockingQuestions: { id: string }[] })
        .blockingQuestions,
    ).toEqual([{ id: "q1", question: "Which auth?" }]);
  });

  it("omits previousPlan/humanFeedback/answers when no prior artifacts exist", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 2, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    const callArgs = plannerAgent.run.mock.calls[0][2];
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanFeedback");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
  });

  it("throws when the run does not exist", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName, then re-plans and proceeds to plan review", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent, gitService } = buildDeps(store);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());
    gitService.setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/new-worktree",
      branchName: "ai/run-1-retry",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.workingDirectory).toBe("/tmp/new-worktree");
    expect(store.run.branchName).toBe("ai/run-1-retry");
  });

  it("does not set up a new worktree when the run already has a branchName", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent, gitService } = buildDeps(store);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const store = createStore(run, []);
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("throws when the run does not exist", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.retryRun("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});
