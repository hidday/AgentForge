import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeArtifact,
  wirePlannerAgent,
  wirePlanReviewerAgent,
} from "./fixtures.js";

describe("OrchestratorService.runPlanning", () => {
  it("re-runs the planner, injects RejectionContext/HumanAnswers/ResearchedAnswers/PlanReview context, and proceeds to plan review when no blockers remain", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "Use OAuth2", source: "api", mode: "iterate" },
      }),
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ planVersion: 1 }),
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
          answers: [{ questionId: "q2", question: "q", answer: "a", confidence: "high" }],
          completedAt: new Date().toISOString(),
        },
      }),
      makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] },
      }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) => makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }));
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: { summary: "review summary", findings: [expect.objectContaining({ id: "f1" })] },
      }),
    );

    // Should end up back in AwaitingPlanApproval (Planning -> PlanReview -> AwaitingPlanApproval)
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(2);
  });

  it("pauses for clarification when the re-plan still has blocking open questions", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () =>
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(store.events.some((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION)).toBe(true);
  });

  it("omits optional re-plan context fields when no prior artifacts exist", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ humanFeedback: expect.anything() }),
    );
    const callArgs = plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callArgs.previousPlan).toBeUndefined();
    expect(callArgs.humanAnswers).toBeUndefined();
    expect(callArgs.researchedAnswers).toBeUndefined();
    expect(callArgs.planReviewFindings).toBeUndefined();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("re-establishes a worktree when the run has no branchName, then plans and reviews", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      planVersion: 1,
      branchName: null,
      workingDirectory: "/tmp/main",
    });
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent, gitService, repoRegistry } =
      buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () => makePlan({ planVersion: 1, openQuestions: [] }));
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main",
      expect.any(String),
    );
    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(store.run.branchName).toBe("ai/run-test1234");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      planVersion: 1,
      branchName: "ai/existing-branch",
    });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent, gitService } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () => makePlan({ planVersion: 1, openQuestions: [] }));
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the plan has blocking open questions", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      planVersion: 1,
      branchName: "ai/existing-branch",
    });
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () =>
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(store.events.some((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION)).toBe(true);
  });
});
