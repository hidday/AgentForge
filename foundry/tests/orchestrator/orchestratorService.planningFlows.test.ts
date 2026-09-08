import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makePlan, makeArtifact } from "./testHelpers.js";

describe("OrchestratorService.runPlanning", () => {
  it("re-runs the planner, persists the new plan version, and proceeds to plan review when no blockers", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    const built = buildDeps({ run });
    built.setPlannerPlan(newPlan);
    const { deps, plannerAgent, runRepo, artifactRepo } = built;

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ planVersion: 2, plannerRuntime: "claude-code" }),
    );
    // TaskBundle artifact should have been persisted since none existed yet.
    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TaskBundle" }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects prior context (rejection feedback, human answers, researched answers, plan review findings) when artifacts exist", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 3 });
    const previousPlan = makePlan({ planVersion: 3 });
    const built = buildDeps({
      run,
      artifacts: {
        RejectionContext: makeArtifact({
          type: "RejectionContext",
          payloadJson: { planVersion: 3, feedback: "be more careful", source: "api", mode: "iterate" },
        }),
        Plan: makeArtifact({ type: "Plan", payloadJson: previousPlan }),
        HumanAnswers: makeArtifact({
          type: "HumanAnswers",
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        ResearchedAnswers: makeArtifact({
          type: "ResearchedAnswers",
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "?", answer: "a", confidence: "high" }],
            completedAt: new Date().toISOString(),
          },
        }),
        PlanReview: makeArtifact({
          type: "PlanReview",
          payloadJson: { summary: "review summary", findings: [] },
        }),
      },
    });
    built.setPlannerPlan(makePlan({ planVersion: 4, openQuestions: [] }));
    const { deps, plannerAgent } = built;

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 4,
        previousPlan,
        humanFeedback: { planVersion: 3, feedback: "be more careful" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "?", answer: "a", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const blockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
    });
    const built = buildDeps({ run });
    built.setPlannerPlan(blockedPlan);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a worktree when the run has no branch, then re-plans from Todo", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, planVersion: 1 });
    const built = buildDeps({ run });
    const { deps, gitService, runRepo } = built;

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ branchName: expect.any(String) }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branch", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps({ run });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps({ run });
    built.setPlannerPlan(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("starts plan revision when the reviewer requests changes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.setPlanReviewResult({
      reviewId: "planreview-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "important",
          title: "Missing tests",
          details: "Add unit tests",
          affectedStepId: "s1",
        },
      ],
    });
    const { deps, planReviserAgent, linearClient } = built;

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const reviewComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Changes Requested"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1]).toContain("Missing tests");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions, and posts a comment with dispositions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = {
      reviewId: "pr-1",
      summary: "Needs revision",
      overallVerdict: "changes_requested" as const,
      findings: [],
    };
    const { deps, planReviserAgent, runRepo, linearClient } = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        PlanReview: makeArtifact({ type: "PlanReview", payloadJson: planReview }),
      },
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Good catch" }],
      },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comment = linearClient.postComment.mock.calls.at(-1)![1] as string;
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Good catch");
  });

  it("forwards an operator note to the plan reviser agent", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = {
      reviewId: "pr-1",
      summary: "Needs revision",
      overallVerdict: "changes_requested" as const,
      findings: [],
    };
    const { deps, planReviserAgent } = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        PlanReview: makeArtifact({ type: "PlanReview", payloadJson: planReview }),
      },
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const { deps, runRepo, linearClient } = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(result.state).toBe(RunState.Implementing);
    const comment = linearClient.postComment.mock.calls.at(-1)![1] as string;
    expect(comment).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const { deps, linearClient } = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "ship it fast" });

    const comment = linearClient.postComment.mock.calls.at(-1)![1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("ship it fast");
  });
});
