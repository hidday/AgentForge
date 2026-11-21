import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, StateTransitionError } from "../../src/utils/errors.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import {
  createHarness,
  makeIssue,
  makePlan,
  makePlanReview,
  makeRepoEntry,
  makeRun,
  makeSkill,
} from "./helpers/orchestratorHarness.js";

const changesRequestedReview = makePlanReview({
  reviewId: "pr-cr",
  summary: "Plan has gaps",
  overallVerdict: "changes_requested",
  findings: [
    {
      id: "pf1",
      severity: "blocker",
      type: "missing-step",
      affectedStepId: "s1",
      title: "No migration",
      details: "The schema change needs a migration",
    },
    {
      id: "pf2",
      severity: "nit",
      type: "style",
      title: "Naming",
      details: "Prefer camelCase",
    },
  ],
});

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------
describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
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

  it("creates a run, sets up a worktree, plans, AI-reviews and lands in AwaitingPlanApproval", async () => {
    const h = createHarness({
      run: null,
      config: {
        plannerOutputs: [
          {
            summary: "Add caching layer",
            confidence: 0.72,
            openQuestions: [
              { id: "q1", question: "Which TTL?", requiredForExecution: false },
            ],
            risks: ["Cache invalidation bugs"],
          },
        ],
      },
    });

    const run = await h.svc.startRun("LIN-1");

    // Repo resolution uses the issue's project/team and validates the dir.
    expect(h.repoRegistry.resolveForIssue).toHaveBeenCalledWith("Proj", "ENG");
    expect(h.repoRegistry.validateWorkingDirectory).toHaveBeenCalledWith("/repos/test-repo");

    expect(h.runRepo.create).toHaveBeenCalledWith({
      linearIssueId: "LIN-1",
      linearIssueIdentifier: "ENG-1",
      linearIssueDescription: "Issue description",
      linearIssueTitle: "Issue title",
      linearIssueUrl: "https://linear.app/x/ENG-1",
      repo: "test-repo",
      workingDirectory: "/repos/test-repo",
    });
    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "main",
      "eng-1-issue-title",
    );
    expect(h.runRepo.update).toHaveBeenCalledWith("run-1", {
      workingDirectory: "/repos/test-repo/.worktrees/run-1",
      branchName: "ai/run-1",
    });
    expect(h.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");

    // Final state + event chain.
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(h.recordedEvent(RunEvent.RUN_REQUESTED)).toMatchObject({
      source: "orchestrator",
      payloadJson: { from: RunState.Todo, to: RunState.Planning },
    });

    // No skill repo configured -> planner receives an empty priorSkills list.
    expect(h.plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({ priorSkills: [] });
    expect(h.store.run?.plannerRuntime).toBe("claude-code");
    expect(h.store.run?.planVersion).toBe(1);

    // The task bundle is persisted once and carries the worktree path.
    const bundles = h.artifactsOfType("TaskBundle");
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0]?.payloadJson as TaskBundle;
    expect(bundle.repo).toMatchObject({
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/repos/test-repo/.worktrees/run-1",
      protectedPaths: ["infra/"],
    });
    expect(bundle.issue).toEqual({
      id: "LIN-1",
      title: "Issue title",
      description: "Issue description",
      labels: ["feature"],
      priority: 2,
      project: "Proj",
      cycle: "Cycle 1",
    });
    expect(bundle.relatedContext).toBeUndefined();

    // Comments: start notice, then the formatted approved plan.
    const comments = h.comments();
    expect(comments).toHaveLength(2);
    expect(comments[0]).toBe(
      'AI planning started for "Issue title". Will produce a plan, have it AI-reviewed, then present for approval.',
    );
    const planComment = comments[1] ?? "";
    expect(planComment).toContain("## AI Plan (v1) -- Confidence: 72%");
    expect(planComment).toContain("*AI plan review: approved*");
    expect(planComment).toContain("Add caching layer");
    expect(planComment).toContain("1. **Add module**: Create src/feature.ts");
    expect(planComment).toContain("2. **Add tests**: Cover the module");
    expect(planComment).toContain("**Open Questions:**\n- Which TTL?");
    expect(planComment).not.toContain("*blocks execution*");
    expect(planComment).toContain("**Risks:**\n- Cache invalidation bugs");
    expect(planComment).toContain("Reply `/approve-plan` to proceed or `/reject-plan` to revise.");
  });

  it("pauses for human clarification when the plan has blocking questions", async () => {
    const h = createHarness({
      run: null,
      config: {
        plannerOutputs: [
          {
            openQuestions: [
              { id: "q1", question: "Which DB?", requiredForExecution: true },
              { id: "q2", question: "Nice to know?", requiredForExecution: false },
            ],
          },
        ],
      },
    });

    const run = await h.svc.startRun("LIN-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
    expect(h.recordedEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)?.payloadJson).toEqual({
      from: RunState.PlanReview,
      to: RunState.HumanClarificationNeeded,
      blockingQuestions: [{ id: "q1", question: "Which DB?" }],
    });
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
    // TaskBundle is persisted even on the blocking branch.
    expect(h.artifactsOfType("TaskBundle")).toHaveLength(1);
  });

  it("does not create a run when the resolved working directory is invalid", async () => {
    const h = createHarness({ run: null });
    h.repoRegistry.validateWorkingDirectory.mockImplementation(() => {
      throw new Error("Working directory does not exist: /repos/test-repo");
    });

    await expect(h.svc.startRun("LIN-1")).rejects.toThrow("Working directory does not exist");
    expect(h.runRepo.create).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it("propagates worktree setup failures before any state transition is recorded", async () => {
    const h = createHarness({ run: null });
    h.gitService.setupRunWorktree.mockRejectedValue(new Error("git worktree add failed"));

    await expect(h.svc.startRun("LIN-1")).rejects.toThrow("git worktree add failed");
    expect(h.runRepo.create).toHaveBeenCalledTimes(1);
    expect(h.store.run?.state).toBe(RunState.Todo);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("refuses to plan when the freshly persisted run is not in Todo/Planning", async () => {
    const h = createHarness({ run: null });
    // Simulate a racing writer moving the run forward between create and update.
    h.runRepo.update.mockImplementationOnce(async (_id, patch) => {
      h.store.run = { ...h.store.run!, ...patch, state: RunState.Implementing };
      return { ...h.store.run };
    });

    const err = await h.svc.startRun("LIN-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it("injects prior skills from the skill repo and records a SKILL_INJECTION event", async () => {
    const longDescription = "d".repeat(300);
    const h = createHarness({
      run: null,
      withSkillRepo: true,
      skills: [makeSkill("sk-1"), makeSkill("sk-2")],
    });
    h.linearClient.getIssue.mockResolvedValue(makeIssue({ description: longDescription }));

    await h.svc.startRun("LIN-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      `Issue title ${"d".repeat(200)}`,
      3,
    );
    expect(h.recordedEvent("SKILL_INJECTION")).toEqual({
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["sk-1", "sk-2"] },
    });
    const opts = h.plannerAgent.run.mock.calls[0]?.[2] as { priorSkills: { id: string }[] };
    expect(opts.priorSkills.map((s) => s.id)).toEqual(["sk-1", "sk-2"]);
  });

  it("does not record SKILL_INJECTION when no skills match", async () => {
    const h = createHarness({ run: null, withSkillRepo: true, skills: [] });

    await h.svc.startRun("LIN-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledTimes(1);
    expect(h.recordedEventTypes()).not.toContain("SKILL_INJECTION");
  });

  it("builds the skill query from empty strings when the run has no title/description", async () => {
    const h = createHarness({ run: null, withSkillRepo: true });
    h.runRepo.create.mockImplementationOnce(async () => {
      h.store.run = makeRun({
        state: RunState.Todo,
        branchName: null,
        linearIssueTitle: null,
        linearIssueDescription: null,
      });
      return { ...h.store.run };
    });

    await h.svc.startRun("LIN-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", 3);
  });

  it("prefers GitHub's remote default branch when it differs from config", async () => {
    const h = createHarness({ run: null });
    h.githubClient.getDefaultBranch.mockResolvedValue("develop");

    await h.svc.startRun("LIN-1");

    const bundle = h.artifactsOfType("TaskBundle")[0]?.payloadJson as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("develop");
    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", config: "main", remote: "develop" },
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the configured default branch when GitHub lookup fails", async () => {
    const h = createHarness({ run: null });
    h.githubClient.getDefaultBranch.mockRejectedValue(new Error("API rate limited"));

    await h.svc.startRun("LIN-1");

    const bundle = h.artifactsOfType("TaskBundle")[0]?.payloadJson as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", error: "API rate limited" },
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("stringifies non-Error failures from GitHub and Linear context lookups", async () => {
    const h = createHarness({ run: null });
    h.githubClient.getDefaultBranch.mockRejectedValue("boom");
    h.linearClient.getRelatedContext.mockRejectedValue("linear down");

    await h.svc.startRun("LIN-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      { repo: "test-repo", error: "boom" },
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", error: "linear down" },
      "Failed to fetch related Linear context; proceeding without it",
    );
  });

  it("works without a dashboard emitter", async () => {
    const h = createHarness({ run: null, withDashboard: false });

    const run = await h.svc.startRun("LIN-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.dashboardEmitter.emitRunCreated).not.toHaveBeenCalled();
    expect(h.dashboardEmitter.emitStateChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runPlanning
// ---------------------------------------------------------------------------
describe("OrchestratorService.runPlanning", () => {
  it("throws when the run does not exist", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.runPlanning("missing")).rejects.toThrow("Run not found: missing");
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("re-plans with all prior context artifacts and continues into plan review", async () => {
    const previousPlan = makePlan({ planVersion: 2, summary: "Old plan" });
    const priorPlanReview = makePlanReview({
      summary: "needs work",
      findings: [
        { id: "f1", severity: "important", type: "gap", title: "Gap", details: "Missing step" },
      ],
      overallVerdict: "changes_requested",
    });
    const h = createHarness({
      run: makeRun({ state: RunState.Planning, planVersion: 2 }),
      artifacts: [
        { type: "TaskBundle", version: 1, payloadJson: { existing: true } },
        { type: "Plan", version: 2, payloadJson: previousPlan },
        {
          type: "RejectionContext",
          version: 2,
          payloadJson: { planVersion: 2, feedback: "Use Redis", source: "api", mode: "iterate" },
        },
        {
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "Postgres" }] },
        },
        {
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "?", answer: "yes", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        },
        { type: "PlanReview", version: 1, payloadJson: priorPlanReview },
      ],
    });

    const run = await h.svc.runPlanning("run-1");

    expect(h.plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({
      planVersionOverride: 3,
      previousPlan,
      humanFeedback: { planVersion: 2, feedback: "Use Redis" },
      humanAnswers: [{ questionId: "q1", answer: "Postgres" }],
      researchedAnswers: [{ questionId: "q2", question: "?", answer: "yes", confidence: "high" }],
      planReviewFindings: { summary: "needs work", findings: priorPlanReview.findings },
    });
    // Existing TaskBundle is reused, not duplicated.
    expect(h.artifactsOfType("TaskBundle")).toHaveLength(1);
    expect(h.store.run?.planVersion).toBe(3);
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    // Plan review saw the freshly created v3 plan.
    expect((h.planReviewerAgent.run.mock.calls[0]?.[0] as { planVersion: number }).planVersion).toBe(3);
  });

  it("passes only the version override when no prior context exists and persists the TaskBundle", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Planning, planVersion: 0 }),
      artifacts: [{ type: "HumanAnswers", version: 1, payloadJson: { answers: [] } }],
    });

    await h.svc.runPlanning("run-1");

    // Empty human answers are not forwarded.
    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({ planVersionOverride: 1 });
    expect(h.artifactsOfType("TaskBundle")).toHaveLength(1);
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      config: {
        plannerOutputs: [
          { openQuestions: [{ id: "qb", question: "Blocking?", requiredForExecution: true }] },
        ],
      },
    });

    const run = await h.svc.runPlanning("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.recordedEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)?.payloadJson).toMatchObject({
      blockingQuestions: [{ id: "qb", question: "Blocking?" }],
    });
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("leaves the run untouched when the planner fails", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Planning, planVersion: 1 }) });
    h.plannerAgent.run.mockRejectedValue(new Error("planner crashed"));

    await expect(h.svc.runPlanning("run-1")).rejects.toThrow("planner crashed");
    expect(h.store.run?.state).toBe(RunState.Planning);
    expect(h.store.run?.planVersion).toBe(1);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it("rejects with a state-transition error when invoked outside Planning", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Done, planVersion: 1 }) });

    await expect(h.svc.runPlanning("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// retryRun
// ---------------------------------------------------------------------------
describe("OrchestratorService.retryRun", () => {
  it("re-creates the worktree when the run has no branch, then plans and reviews", async () => {
    const h = createHarness({
      run: makeRun({
        state: RunState.Todo,
        branchName: null,
        workingDirectory: "/repos/test-repo/.worktrees/old",
      }),
    });
    h.repoRegistry.getRepoByName.mockReturnValue(makeRepoEntry({ defaultBranch: "trunk" }));
    h.githubClient.getDefaultBranch.mockResolvedValue("trunk");

    const run = await h.svc.retryRun("run-1");

    expect(h.gitService.resolveMainRepoPath).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/old",
    );
    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "trunk",
      "eng-1-issue-title",
    );
    expect(h.runRepo.update).toHaveBeenCalledWith("run-1", {
      workingDirectory: "/repos/test-repo/.worktrees/run-1",
      branchName: "ai/run-1",
    });
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toEqual({ priorSkills: [] });
    expect(h.artifactsOfType("TaskBundle")).toHaveLength(1);
  });

  it("falls back to the default repo when the run's repo is no longer registered", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Todo, branchName: null }) });
    h.repoRegistry.getRepoByName.mockReturnValue(undefined);
    h.repoRegistry.getDefaultRepo.mockReturnValue(
      makeRepoEntry({ name: "default-repo", defaultBranch: "master" }),
    );
    h.githubClient.getDefaultBranch.mockResolvedValue("master");

    await h.svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "master",
      "eng-1-issue-title",
    );
    const bundle = h.artifactsOfType("TaskBundle")[0]?.payloadJson as TaskBundle;
    expect(bundle.repo.name).toBe("default-repo");
  });

  it("reuses the existing branch without touching git worktrees", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }) });

    await h.svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(h.gitService.resolveMainRepoPath).not.toHaveBeenCalled();
  });

  it("pauses for clarification on blocking questions", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Todo }),
      config: {
        plannerOutputs: [
          { openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }] },
        ],
      },
    });

    const run = await h.svc.retryRun("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rejects when the run is not in Todo and never invokes the planner", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.Done }) });

    await expect(h.svc.retryRun("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runPlanReview / runPlanRevision
// ---------------------------------------------------------------------------
describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no plan artifact", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanReview }) });

    await expect(h.svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("on approval transitions to AwaitingPlanApproval and posts the plan without optional sections", async () => {
    const plan = makePlan({ planVersion: 4, confidence: 0.5 });
    const h = createHarness({
      run: makeRun({ state: RunState.PlanReview, planVersion: 4 }),
      artifacts: [{ type: "Plan", version: 4, payloadJson: plan }],
    });

    const run = await h.svc.runPlanReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviewerAgent.run.mock.calls[0]?.[0]).toEqual(plan);
    expect(h.planReviewerAgent.run.mock.calls[0]?.[2]).toBe("run-1");
    expect(h.recordedEvent(RunEvent.PLAN_REVIEW_APPROVED)?.source).toBe("plan-reviewer-agent");
    const [comment] = h.comments();
    expect(comment).toContain("## AI Plan (v4) -- Confidence: 50%");
    expect(comment).not.toContain("Open Questions");
    expect(comment).not.toContain("Risks");
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("on changes_requested posts findings, revises the plan and lands in AwaitingPlanApproval", async () => {
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Need SSO?", requiredForExecution: true }],
    });
    const h = createHarness({
      run: makeRun({ state: RunState.PlanReview, planVersion: 1 }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: plan }],
      config: {
        planReviews: [changesRequestedReview],
        dispositions: [
          { findingId: "pf1", status: "accepted", rationale: "Added migration step" },
          { findingId: "pf2", status: "dismissed", rationale: "Matches codebase style" },
        ],
      },
    });

    const run = await h.svc.runPlanReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(h.recordedEvent(RunEvent.PLAN_REVISED)?.source).toBe("plan-reviser-agent");

    // Reviser received the plan + the persisted PlanReview and no operator note.
    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      changesRequestedReview,
      expect.objectContaining({ repo: expect.objectContaining({ name: "test-repo" }) }),
      "run-1",
      undefined,
    );
    expect(h.store.run?.planVersion).toBe(2);

    const [reviewComment, revisionComment] = h.comments();
    expect(reviewComment).toBe(
      [
        "## AI Plan Review -- Changes Requested",
        "",
        "Plan has gaps",
        "",
        "### Findings",
        "- **[BLOCKER]** No migration (step s1)\n  The schema change needs a migration\n" +
          "- **[NIT]** Naming\n  Prefer camelCase",
      ].join("\n"),
    );
    expect(revisionComment).toContain("## AI Plan (v2)");
    expect(revisionComment).toContain("*Revised after AI review*");
    expect(revisionComment).toContain("- Need SSO? *blocks execution*");
    expect(revisionComment).toContain("### Plan Revision Dispositions");
    expect(revisionComment).toContain("- **pf1** [accepted]: Added migration step");
    expect(revisionComment).toContain("- **pf2** [dismissed]: Matches codebase style");
  });

  it("does not transition when the plan reviewer agent fails", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });
    h.planReviewerAgent.run.mockRejectedValue(new Error("codex unavailable"));

    await expect(h.svc.runPlanReview("run-1")).rejects.toThrow("codex unavailable");
    expect(h.store.run?.state).toBe(RunState.PlanReview);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("forwards an operator note to the reviser", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        { type: "PlanReview", version: 1, payloadJson: changesRequestedReview },
      ],
    });

    const run = await h.svc.runPlanRevision("run-1", { note: "keep it small" });

    expect(h.planReviserAgent.run.mock.calls[0]?.[4]).toEqual({ operatorNote: "keep it small" });
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(run.planVersion).toBe(2);
  });

  it("fails the transition when the run is not in PlanRevision", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        { type: "PlanReview", version: 1, payloadJson: changesRequestedReview },
      ],
    });

    await expect(h.svc.runPlanRevision("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.recordedEventTypes()).not.toContain(RunEvent.PLAN_REVISED);
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("propagates reviser failures without bumping the plan version", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });
    h.planReviserAgent.run.mockRejectedValue(new Error("reviser timeout"));

    await expect(h.svc.runPlanRevision("run-1")).rejects.toThrow("reviser timeout");
    expect(h.runRepo.update).not.toHaveBeenCalled();
    expect(h.store.run?.state).toBe(RunState.PlanRevision);
  });
});

// ---------------------------------------------------------------------------
// approvePlan
// ---------------------------------------------------------------------------
describe("OrchestratorService.approvePlan", () => {
  it("throws when the run does not exist", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.approvePlan("nope")).rejects.toThrow("Run not found: nope");
  });

  it("throws without a plan artifact and records no approval", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });

    await expect(h.svc.approvePlan("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
    expect(h.runRepo.update).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it("records the approved plan version and moves to Implementing", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }),
      artifacts: [{ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) }],
    });

    const run = await h.svc.approvePlan("run-1");

    expect(h.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(run.state).toBe(RunState.Implementing);
    expect(run.approvedPlanVersion).toBe(3);
    expect(h.recordedEvent(RunEvent.PLAN_APPROVED)).toMatchObject({
      source: "human",
      payloadJson: { from: RunState.AwaitingPlanApproval, to: RunState.Implementing },
    });
    expect(h.comments()).toEqual(["Plan v3 approved. Starting implementation..."]);
    expect(h.linearSync.syncState).toHaveBeenCalledWith(
      expect.objectContaining({ state: RunState.Implementing }),
    );
    expect(h.githubSync.syncState).toHaveBeenCalledWith(
      expect.objectContaining({ state: RunState.Implementing }),
    );
    expect(h.dashboardEmitter.emitStateChanged).toHaveBeenCalledWith(
      "run-1",
      RunState.AwaitingPlanApproval,
      RunState.Implementing,
    );
  });

  it("includes the operator note in the event payload and comment", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });

    await h.svc.approvePlan("run-1", { note: "watch the migration" });

    expect(h.recordedEvent(RunEvent.PLAN_APPROVED)?.payloadJson).toEqual({
      from: RunState.AwaitingPlanApproval,
      to: RunState.Implementing,
      note: "watch the migration",
    });
    expect(h.comments()).toEqual([
      "Plan v1 approved with operator note. Starting implementation...\n\n> watch the migration",
    ]);
  });

  it("rejects approval from a state that does not allow it", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });

    await expect(h.svc.approvePlan("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.recordedEventTypes()).not.toContain(RunEvent.PLAN_APPROVED);
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
    expect(h.store.run?.state).toBe(RunState.PlanReview);
  });
});
