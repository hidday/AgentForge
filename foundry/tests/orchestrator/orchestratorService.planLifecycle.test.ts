import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  makeRun,
  makePlan,
  makeArtifact,
  makePlanReview,
  buildFullDeps,
} from "./testHelpers.js";

describe("OrchestratorService -- getters", () => {
  it("exposes the underlying dependency instances via their getters", () => {
    const run = makeRun();
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(built.agentSkillRepo);
    expect(svc.getLinearClient()).toBe(built.linearClient);
  });
});

describe("OrchestratorService.startRun -- active run short-circuit", () => {
  it("returns the existing active run without creating a new one or calling the planner", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    const built = buildFullDeps({ run: existing });
    built.runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(built.runRepo.create).not.toHaveBeenCalled();
    expect(built.plannerAgent.run).not.toHaveBeenCalled();
    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("verdict=approved: transitions to AwaitingPlanApproval and posts an 'approved' plan comment", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan({ planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "approved" }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("AI plan review: approved"),
    );
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("verdict=changes_requested: posts findings comment and chains into runPlanRevision", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan({ planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: plan })],
    });
    const planReview = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "scope", title: "Missing step", details: "d", affectedStepId: "s1" },
      ],
    });
    built.planReviewerAgent.run.mockResolvedValue(planReview);
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(built.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions via PLAN_REVISED, and posts plan+disposition comments", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: plan }),
        makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      ],
    });
    const revisedPlan = makePlan({ planVersion: 3, summary: "Revised plan" });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Makes sense" }],
      },
      revisedPlan,
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = built.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Makes sense");
  });

  it("passes an operator note through to the plan reviser agent", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: plan }),
        makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      ],
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1", { note: "Keep it minimal" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "Keep it minimal" },
    );
  });

  it("passes undefined options to the plan reviser agent when no note is given", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: plan }),
        makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      ],
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("always returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
  });

  it("STILL returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested", findings: [] }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    // Even on changes_requested, runManualReReview records PLAN_REVIEW_APPROVED
    // (by design: it always routes back to human approval rather than auto-revising).
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
  });

  it("records the operator note on the RE_REVIEW_REQUESTED event and forwards it to the plan reviewer", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runManualReReview("run-1", { note: "double check auth" });

    const reReviewEvent = built.eventRepo.create.mock.calls[0]?.[0] as {
      payloadJson: Record<string, unknown>;
    };
    expect(reReviewEvent.payloadJson).toMatchObject({ trigger: "re-review", note: "double check auth" });
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
  });

  it("throws when no plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("verdict=approved: records PLAN_REVIEW_APPROVED and does NOT call the plan reviser", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("verdict=changes_requested: records PLAN_REVIEW_CHANGES_REQUESTED then chains into runPlanRevision with the operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested", findings: [] }),
    );
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
  });

  it("throws when no plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runPlanning (retry planning)", () => {
  it("re-runs the planner with planVersionOverride = planVersion + 1 and injects prior context artifacts", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });
    const previousPlan = makePlan({ planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: previousPlan })],
    });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    built.plannerAgent.run.mockResolvedValue(newPlan);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 3, previousPlan }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification again when the re-plan still has blocking questions", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const previousPlan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: previousPlan })],
    });
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
    });
    built.plannerAgent.run.mockResolvedValue(newPlan);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const built = buildFullDeps({ run });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run.mockResolvedValue(newPlan);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    built.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
  });

  it("does NOT set up a worktree when the run already has a branchName", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const built = buildFullDeps({ run });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run.mockResolvedValue(newPlan);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the fresh plan has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const built = buildFullDeps({ run });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
