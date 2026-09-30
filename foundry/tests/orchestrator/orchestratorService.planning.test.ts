import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import {
  createHarness,
  makeRun,
  makePlan,
  makePlanReview,
  ISSUE,
  REPO_ENTRY,
} from "./orchestratorHarness.js";

const blockingQ = { id: "q1", question: "Which DB?", requiredForExecution: true };
const optionalQ = { id: "q2", question: "Naming?", requiredForExecution: false };

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating anything", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    const h = createHarness({ run: null });
    h.runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await h.svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(h.linearClient.getIssue).not.toHaveBeenCalled();
    expect(h.runRepo.create).not.toHaveBeenCalled();
    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("happy path: creates run + worktree, plans, persists TaskBundle, AI-approves and awaits human approval", async () => {
    const h = createHarness({ run: null });

    const result = await h.svc.startRun("LIN-1");

    expect(h.repoRegistry.resolveForIssue).toHaveBeenCalledWith("proj", "team");
    expect(h.repoRegistry.validateWorkingDirectory).toHaveBeenCalledWith("/repos/test-repo");
    expect(h.runRepo.create).toHaveBeenCalledWith({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: ISSUE.description,
      linearIssueTitle: ISSUE.title,
      linearIssueUrl: ISSUE.url,
      repo: "test-repo",
      workingDirectory: "/repos/test-repo",
    });
    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-new",
      "main",
      ISSUE.branchName,
    );
    expect(h.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-new", "LIN-1", "test-repo");

    expect(h.eventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.workingDirectory).toBe("/repos/test-repo/.worktrees/run-new");
    expect(result.branchName).toBe("ai/eng-1-add-widget");
    expect(result.planVersion).toBe(1);
    expect(result.plannerRuntime).toBe("claude-code");

    // Planner received a bundle that uses the new worktree + branch
    const bundle = h.plannerAgent.run.mock.calls[0]![0] as TaskBundle;
    expect(bundle.repo.repoPath).toBe("/repos/test-repo/.worktrees/run-new");
    expect(bundle.repo.workingBranch).toBe("ai/eng-1-add-widget");
    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({ priorSkills: [] });

    const bundles = h.state.artifacts.filter((a) => a.type === "TaskBundle");
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.payloadJson).toEqual(bundle);

    expect(h.state.comments[0]!.body).toContain('AI planning started for "Add widget"');
    expect(h.state.comments[1]!.body).toContain("*AI plan review: approved*");
  });

  it("aborts before any transition when the policy engine refuses to plan", async () => {
    const h = createHarness({ run: null });
    // Simulate a repo that returns a run in an unexpected state after worktree setup
    h.runRepo.update.mockImplementationOnce(async () =>
      makeRun({ id: "run-new", state: RunState.Implementing }),
    );
    await expect(h.svc.startRun("LIN-1")).rejects.toMatchObject({
      rule: "plan_requires_todo_or_planning_state",
    });
    expect(h.state.events).toHaveLength(0);
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("chains into plan revision when the AI plan reviewer requests changes", async () => {
    const h = createHarness({ run: null });
    h.planReviewerAgent.run.mockImplementationOnce(async () => {
      const review = makePlanReview({
        overallVerdict: "changes_requested",
        summary: "Missing tests",
        findings: [
          {
            id: "pf1",
            severity: "important",
            type: "gap",
            affectedStepId: "s1",
            title: "No test step",
            details: "Add tests",
          },
          {
            id: "pf2",
            severity: "nit",
            type: "style",
            title: "Wording",
            details: "Rephrase",
          },
        ],
      });
      h.addArtifact("PlanReview", review);
      return review;
    });

    const result = await h.svc.startRun("LIN-1");

    expect(h.eventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);

    // Reviser got the latest plan + plan review and no operator note
    const [planArg, reviewArg, , , optsArg] = h.planReviserAgent.run.mock.calls[0]!;
    expect((planArg as { planVersion: number }).planVersion).toBe(1);
    expect((reviewArg as { summary: string }).summary).toBe("Missing tests");
    expect(optsArg).toBeUndefined();

    const reviewComment = h.state.comments.find((c) => c.body.startsWith("## AI Plan Review"))!;
    expect(reviewComment.body).toContain("## AI Plan Review -- Changes Requested");
    expect(reviewComment.body).toContain("- **[IMPORTANT]** No test step (step s1)\n  Add tests");
    expect(reviewComment.body).toContain("- **[NIT]** Wording\n  Rephrase");

    const revisionComment = h.state.comments.at(-1)!.body;
    expect(revisionComment).toContain("## AI Plan (v2)");
    expect(revisionComment).toContain("*Revised after AI review*");
    expect(revisionComment).toContain("### Plan Revision Dispositions");
    expect(revisionComment).toContain("- **pf1** [accepted]: Good catch");
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with every available context artifact and bumps the plan version", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Planning, planVersion: 2 }) });
    const prevPlan = makePlan({ planVersion: 2 });
    h.addArtifact("TaskBundle", { existing: true });
    h.addArtifact("Plan", prevPlan, 2);
    h.addArtifact("RejectionContext", {
      planVersion: 2,
      feedback: "Use postgres",
      source: "api",
      mode: "iterate",
    });
    h.addArtifact("HumanAnswers", { answers: [{ questionId: "q1", answer: "pg" }] });
    h.addArtifact("ResearchedAnswers", {
      summary: "",
      answers: [{ questionId: "q2", question: "x", answer: "y", confidence: "high" }],
    });
    h.addArtifact("PlanReview", makePlanReview({ summary: "prior review", findings: [] }));

    const result = await h.svc.runPlanning("run-1");

    const opts = h.plannerAgent.run.mock.calls[0]![2];
    expect(opts).toEqual({
      planVersionOverride: 3,
      previousPlan: prevPlan,
      humanFeedback: { planVersion: 2, feedback: "Use postgres" },
      humanAnswers: [{ questionId: "q1", answer: "pg" }],
      researchedAnswers: [{ questionId: "q2", question: "x", answer: "y", confidence: "high" }],
      planReviewFindings: { summary: "prior review", findings: [] },
    });
    // TaskBundle already existed -> not re-created
    expect(h.state.artifacts.filter((a) => a.type === "TaskBundle")).toHaveLength(1);
    expect(h.eventTypes()).toEqual([RunEvent.PLAN_CREATED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(3);
  });

  it("passes only the version override when no prior context exists (empty answer lists are dropped)", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Planning, planVersion: 1 }) });
    h.addArtifact("HumanAnswers", { answers: [] });
    h.addArtifact("ResearchedAnswers", { summary: "", answers: [] });

    await h.svc.runPlanning("run-1");

    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({ planVersionOverride: 2 });
    // TaskBundle created because none existed
    expect(h.state.artifacts.filter((a) => a.type === "TaskBundle")).toHaveLength(1);
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Planning, planVersion: 1 }) });
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({ planVersion: 2, openQuestions: [blockingQ, optionalQ] });
      h.addArtifact("Plan", p, 2);
      return p;
    });

    const result = await h.svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.eventTypes()).toEqual([RunEvent.PLAN_CREATED, RunEvent.NEEDS_HUMAN_CLARIFICATION]);
    expect(h.state.events[1]!.payloadJson).toMatchObject({
      blockingQuestions: [{ id: "q1", question: "Which DB?" }],
    });
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("runs the answer researcher with prior human answers and re-plans with both", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      withResearcher: true,
    });
    const humanAnswers = [{ questionId: "q1", answer: "pg" }];
    h.addArtifact("HumanAnswers", { answers: humanAnswers });
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({ planVersion: 2, openQuestions: [optionalQ] });
      h.addArtifact("Plan", p, 2);
      return p;
    });
    const researched = [
      { questionId: "q2", question: "Naming?", answer: "widget", confidence: "medium" },
      { questionId: "q3", question: "?", answer: "", confidence: "unresolved" },
    ];
    h.answerResearcherAgent.run.mockResolvedValueOnce({
      summary: "s",
      answers: researched,
      completedAt: "",
    } as never);

    const result = await h.svc.runPlanning("run-1");

    expect(h.answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 2 }),
      expect.anything(),
      "run-1",
      { humanAnswers },
    );
    const replanOpts = h.plannerAgent.run.mock.calls[1]![2] as Record<string, unknown>;
    expect(replanOpts).toEqual({
      planVersionOverride: 3,
      previousPlan: expect.objectContaining({ planVersion: 2 }),
      researchedAnswers: researched,
      humanAnswers,
    });
    const researchEvt = h.state.events.find((e) => e.eventType === "RESEARCH_COMPLETED")!;
    expect(researchEvt.payloadJson).toEqual({
      planVersion: 2,
      answeredCount: 2,
      resolvedCount: 1,
      unresolvedCount: 1,
    });
    expect(result.planVersion).toBe(3);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when the run does not exist", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.runPlanning("missing")).rejects.toThrow("Run not found: missing");
  });
});

describe("OrchestratorService.retryRun", () => {
  it("re-creates the worktree using the default repo when the run has no branch", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Todo, branchName: null, repo: "gone-repo" }),
    });
    h.repoRegistry.getRepoByName.mockReturnValue(undefined);

    const result = await h.svc.retryRun("run-1");

    expect(h.gitService.resolveMainRepoPath).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
    );
    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "trunk",
      ISSUE.branchName,
    );
    expect(result.branchName).toBe("ai/eng-1-add-widget");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.eventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
  });

  it("reuses the existing branch/worktree when present", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Todo }) });
    const result = await h.svc.retryRun("run-1");
    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.branchName).toBe("ai/run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for clarification when the retried plan has blocking questions", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Todo }) });
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({ openQuestions: [blockingQ] });
      h.addArtifact("Plan", p);
      return p;
    });
    const result = await h.svc.retryRun("run-1");
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.eventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
  });

  it("rejects retrying a run that is not in Todo (state machine guard)", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Implementing }) });
    await expect(h.svc.retryRun("run-1")).rejects.toThrow(
      'No transition from state "Implementing" for event "RUN_REQUESTED"',
    );
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview / runPlanRevision", () => {
  it("runPlanReview throws when there is no plan artifact", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanReview }) });
    await expect(h.svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("runPlanRevision forwards an operator note to the reviser", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanRevision }) });
    h.addArtifact("Plan", makePlan({ planVersion: 4 }), 4);
    h.addArtifact("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));

    const result = await h.svc.runPlanRevision("run-1", { note: "keep it small" });

    expect(h.planReviserAgent.run.mock.calls[0]![4]).toEqual({ operatorNote: "keep it small" });
    expect(result.planVersion).toBe(5);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records the approved plan version, transitions to Implementing and posts a comment", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }),
    });
    h.addArtifact("Plan", makePlan({ planVersion: 3 }), 3);

    const result = await h.svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(3);
    expect(h.state.events[0]!.payloadJson).toEqual({
      from: RunState.AwaitingPlanApproval,
      to: RunState.Implementing,
    });
    expect(h.state.comments.at(-1)!.body).toBe("Plan v3 approved. Starting implementation...");
  });

  it("includes an operator note in the event payload and comment", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    h.addArtifact("Plan", makePlan({ planVersion: 1 }));

    await h.svc.approvePlan("run-1", { note: "ship it" });

    expect(h.state.events[0]!.payloadJson).toMatchObject({ note: "ship it" });
    expect(h.state.comments.at(-1)!.body).toBe(
      "Plan v1 approved with operator note. Starting implementation...\n\n> ship it",
    );
  });

  it("throws without a plan artifact and leaves the run untouched", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    await expect(h.svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found");
    expect(h.runRepo.update).not.toHaveBeenCalled();
    expect(h.currentRun().approvedPlanVersion).toBeNull();
  });

  it("cannot approve a plan that is still under AI review", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanReview }) });
    h.addArtifact("Plan", makePlan());
    await expect(h.svc.approvePlan("run-1")).rejects.toThrow(
      'No transition from state "PlanReview" for event "PLAN_APPROVED"',
    );
    expect(h.currentRun().state).toBe(RunState.PlanReview);
  });
});

describe("OrchestratorService.rejectPlan modes", () => {
  it("fresh mode ignores prior plan/answers/review context and only passes feedback", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
    });
    h.addArtifact("Plan", makePlan({ planVersion: 2 }), 2);
    h.addArtifact("HumanAnswers", { answers: [{ questionId: "q1", answer: "a" }] });
    h.addArtifact("PlanReview", makePlanReview());

    const result = await h.svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({
      priorSkills: [],
      planVersionOverride: 3,
      humanFeedback: { planVersion: 2, feedback: "start over" },
    });
    expect(h.state.events[0]!.payloadJson).toMatchObject({
      feedback: "start over",
      mode: "fresh",
    });
    expect(h.state.comments[0]!.body).toBe(
      "Plan rejected (fresh) with feedback: start over\nReplanning...",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("iterate mode loads previous plan, human + researched answers and review findings", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
    });
    const prev = makePlan({ planVersion: 2 });
    h.addArtifact("Plan", prev, 2);
    h.addArtifact("HumanAnswers", { answers: [{ questionId: "q1", answer: "a" }] });
    h.addArtifact("ResearchedAnswers", {
      answers: [{ questionId: "q2", question: "?", answer: "b", confidence: "low" }],
    });
    h.addArtifact("PlanReview", makePlanReview({ summary: "rv", findings: [] }));

    await h.svc.rejectPlan("run-1");

    expect(h.plannerAgent.run.mock.calls[0]![2]).toEqual({
      priorSkills: [],
      planVersionOverride: 3,
      previousPlan: prev,
      humanAnswers: [{ questionId: "q1", answer: "a" }],
      researchedAnswers: [{ questionId: "q2", question: "?", answer: "b", confidence: "low" }],
      planReviewFindings: { summary: "rv", findings: [] },
    });
    // whitespace-free absence of context: no RejectionContext artifact
    expect(h.state.artifacts.some((a) => a.type === "RejectionContext")).toBe(false);
    expect(h.state.comments[0]!.body).toBe("Plan rejected (iterate). Replanning...");
  });

  it("treats whitespace-only feedback as no feedback (no artifact, generic comment)", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    await h.svc.rejectPlan("run-1", "   ");
    expect(h.state.artifacts.some((a) => a.type === "RejectionContext")).toBe(false);
    expect(h.state.comments[0]!.body).toBe("Plan rejected (iterate). Replanning...");
    // but the raw feedback is still captured on the event payload
    expect(h.state.events[0]!.payloadJson).toMatchObject({ feedback: "   " });
  });

  it("pauses for clarification when the re-plan after rejection has blocking questions", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({ planVersion: 2, openQuestions: [blockingQ] });
      h.addArtifact("Plan", p, 2);
      return p;
    });
    const result = await h.svc.rejectPlan("run-1", "nope");
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.eventTypes()).toEqual([
      RunEvent.PLAN_REJECTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService manual re-review / revision", () => {
  function awaiting() {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    h.addArtifact("Plan", makePlan());
    return h;
  }

  it.each(["approved", "changes_requested"] as const)(
    "runManualReReview returns to AwaitingPlanApproval even when verdict is %s",
    async (verdict) => {
      const h = awaiting();
      h.planReviewerAgent.run.mockResolvedValueOnce(
        makePlanReview({ overallVerdict: verdict }) as never,
      );
      const result = await h.svc.runManualReReview("run-1");
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(h.eventTypes()).toEqual([
        RunEvent.RE_REVIEW_REQUESTED,
        RunEvent.PLAN_REVIEW_APPROVED,
      ]);
      expect(h.state.events[0]!.payloadJson).toMatchObject({ trigger: "re-review" });
      expect(h.planReviewerAgent.run.mock.calls[0]![3]).toBeUndefined();
      expect(h.planReviserAgent.run).not.toHaveBeenCalled();
    },
  );

  it("runManualReReview forwards the operator note to the event and reviewer", async () => {
    const h = awaiting();
    await h.svc.runManualReReview("run-1", { note: "check perf" });
    expect(h.state.events[0]!.payloadJson).toMatchObject({
      trigger: "re-review",
      note: "check perf",
    });
    expect(h.planReviewerAgent.run.mock.calls[0]![3]).toEqual({ operatorNote: "check perf" });
  });

  it("runManualReReview throws when no plan exists (after recording the request)", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    await expect(h.svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found");
    expect(h.currentRun().state).toBe(RunState.PlanReview);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("runManualPlanRevision: approved verdict returns to approval without revising", async () => {
    const h = awaiting();
    const result = await h.svc.runManualPlanRevision("run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.state.events[0]!.payloadJson).toMatchObject({ trigger: "revise" });
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("runManualPlanRevision: changes requested chains into a revision carrying the note", async () => {
    const h = awaiting();
    h.planReviewerAgent.run.mockImplementationOnce(async () => {
      const r = makePlanReview({ overallVerdict: "changes_requested" });
      h.addArtifact("PlanReview", r);
      return r;
    });
    const result = await h.svc.runManualPlanRevision("run-1", { note: "split step" });

    expect(h.eventTypes()).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(h.state.events[0]!.payloadJson).toMatchObject({ trigger: "revise", note: "split step" });
    expect(h.planReviewerAgent.run.mock.calls[0]![3]).toEqual({ operatorNote: "split step" });
    expect(h.planReviserAgent.run.mock.calls[0]![4]).toEqual({ operatorNote: "split step" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
  });

  it("runManualPlanRevision: changes requested without a note passes no operator options", async () => {
    const h = awaiting();
    h.planReviewerAgent.run.mockImplementationOnce(async () => {
      const r = makePlanReview({ overallVerdict: "changes_requested" });
      h.addArtifact("PlanReview", r);
      return r;
    });
    await h.svc.runManualPlanRevision("run-1");
    expect(h.planReviserAgent.run.mock.calls[0]![4]).toBeUndefined();
  });

  it("runManualPlanRevision throws when no plan exists", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    await expect(h.svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found");
  });

  it("manual re-review is refused from states other than AwaitingPlanApproval", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Implementing }) });
    await expect(h.svc.runManualReReview("run-1")).rejects.toThrow(/RE_REVIEW_REQUESTED/);
    expect(h.state.events).toHaveLength(0);
  });
});

describe("OrchestratorService.answerQuestions iteration", () => {
  it("returns to HumanClarificationNeeded with an incremented iteration while under the limit, preserving researched answers", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }),
    });
    h.addArtifact("Plan", makePlan({ planVersion: 2, openQuestions: [blockingQ] }), 2);
    h.addArtifact("TaskBundle", { issue: { id: "LIN-1" } });
    const researched = [{ questionId: "q9", question: "?", answer: "x", confidence: "high" }];
    h.addArtifact("ResearchedAnswers", { answers: researched });
    h.addEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    h.plannerAgent.run.mockImplementationOnce(async () => {
      const p = makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q5", question: "Which region?", requiredForExecution: true }],
      });
      h.addArtifact("Plan", p, 3);
      return p;
    });

    const answers = [{ questionId: "q1", answer: "postgres" }];
    const result = await h.svc.answerQuestions("run-1", answers);

    expect(h.plannerAgent.run).toHaveBeenCalledWith({ issue: { id: "LIN-1" } }, "run-1", {
      humanAnswers: answers,
      researchedAnswers: researched,
      planVersionOverride: 3,
    });
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const last = h.state.events.at(-1)!;
    expect(last.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(last.payloadJson).toMatchObject({
      blockingQuestions: [{ id: "q5", question: "Which region?" }],
      iteration: 2,
    });
    expect(h.dashboardEmitter.emitQuestionsAnswered).toHaveBeenCalledWith("run-1", 1);
  });

  it("throws when no plan artifact exists", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.HumanClarificationNeeded }) });
    await expect(h.svc.answerQuestions("run-1", [])).rejects.toThrow("No plan artifact found");
  });

  it("throws when the TaskBundle artifact is missing after transitioning to Planning", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.HumanClarificationNeeded }) });
    h.addArtifact("Plan", makePlan({ openQuestions: [blockingQ] }));
    await expect(
      h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "a" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
    expect(h.currentRun().state).toBe(RunState.Planning);
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle (via runPlanning)", () => {
  async function bundleFor(setup: (h: ReturnType<typeof createHarness>) => void) {
    const h = createHarness({
      run: makeRun({ state: RunState.Planning, branchName: null }),
    });
    setup(h);
    await h.svc.runPlanning("run-1");
    return { h, bundle: h.plannerAgent.run.mock.calls[0]![0] as TaskBundle };
  }

  it("builds a complete bundle from issue + repo config", async () => {
    const { bundle } = await bundleFor(() => undefined);
    expect(bundle).toEqual({
      issue: {
        id: "LIN-1",
        title: ISSUE.title,
        description: ISSUE.description,
        labels: ["feature"],
        priority: 2,
        project: "proj",
        cycle: undefined,
      },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        // run.branchName is null -> falls back to the issue's branch name
        workingBranch: ISSUE.branchName,
        repoPath: "/repos/test-repo/.worktrees/run-1",
        allowedPaths: REPO_ENTRY.allowedPaths,
        protectedPaths: REPO_ENTRY.protectedPaths,
      },
      constraints: REPO_ENTRY.constraints,
      definitionOfDone: expect.arrayContaining(["All required checks pass"]),
    });
    expect(bundle.definitionOfDone).toHaveLength(5);
  });

  it("prefers GitHub's default branch over config and warns about the drift", async () => {
    const { h, bundle } = await bundleFor((h) => {
      h.githubClient.getDefaultBranch.mockResolvedValue("develop");
    });
    expect(bundle.repo.defaultBranch).toBe("develop");
    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", config: "main", remote: "develop" },
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the config branch when GitHub lookup fails with a non-Error value", async () => {
    const { h, bundle } = await bundleFor((h) => {
      h.githubClient.getDefaultBranch.mockRejectedValue("rate limited");
    });
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", error: "rate limited" },
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("falls back to the config branch when GitHub lookup throws an Error", async () => {
    const { h, bundle } = await bundleFor((h) => {
      h.githubClient.getDefaultBranch.mockRejectedValue(new Error("boom"));
    });
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", error: "boom" },
      expect.stringContaining("Failed to resolve default branch"),
    );
  });

  it("includes related context when only a parent exists, and logs non-Error related-context failures", async () => {
    const parent = { id: "p", identifier: "ENG-0", title: "Epic" };
    const { bundle } = await bundleFor((h) => {
      h.linearClient.getRelatedContext.mockResolvedValue({ parent, blockers: [] } as never);
    });
    expect(bundle.relatedContext).toEqual({ parent, blockers: [] });

    const { h: h2, bundle: b2 } = await bundleFor((h) => {
      h.linearClient.getRelatedContext.mockRejectedValue("nope");
    });
    expect(b2.relatedContext).toBeUndefined();
    expect(h2.logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", error: "nope" },
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService policy guard on startRun state", () => {
  it("PolicyViolationError from startRun is the real PolicyEngine error type", async () => {
    const h = createHarness({ run: null });
    h.runRepo.update.mockImplementationOnce(async () =>
      makeRun({ id: "run-new", state: RunState.Done }),
    );
    await expect(h.svc.startRun("LIN-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });
});
