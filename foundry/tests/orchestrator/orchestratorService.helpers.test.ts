import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeExecutionReport,
  makeArtifact,
  wirePlannerAgent,
  wirePlanReviewerAgent,
  wireExecutorAgent,
  wireReviewerAgent,
} from "./fixtures.js";

describe("OrchestratorService -- Linear comment formatting detail branches", () => {
  it("formatPlanComment includes the Open Questions and Risks sections when present", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [
        { id: "q1", question: "Blocking one?", requiredForExecution: true },
        { id: "q2", question: "Non-blocking one?", requiredForExecution: false },
      ],
      risks: ["Might break prod", "Flaky test suite"],
    });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("**Open Questions:**");
    expect(comment).toContain("Blocking one? *blocks execution*");
    expect(comment).toContain("Non-blocking one?");
    expect(comment).not.toContain("Non-blocking one? *blocks execution*");
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Might break prod");
  });

  it("formatExecutionReportComment renders the fail and skip check icons distinctly from pass", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () =>
      makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "all green" },
        },
      }),
    );
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    // The executor's report has failing lint, which the subsequent markReady
    // call (reached via the approved code review) rejects -- irrelevant to
    // what this test checks (the comment text posted along the way).
    await expect(svc.runExecution("run-1")).rejects.toThrow(/failing checks/);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain(":x: **Lint**");
    expect(comment).toContain(":heavy_minus_sign: **Typecheck**");
    expect(comment).toContain(":white_check_mark: **Tests**");
  });

  it("formatPlanReviewComment includes the affected step id when a finding references one", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () =>
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", affectedStepId: "s1", title: "Missing validation", details: "x" },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("AI Plan Review"),
    )![1] as string;
    expect(comment).toContain("(step s1)");
  });

  it("formatCodeReviewComment includes the line hint when a finding specifies one", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 10, planVersion: 1 });
    const { deps, reviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "found issues",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", lineHint: 42, title: "Off by one", details: "x" },
      ],
      overallVerdict: "changes_requested",
    }));

    let caught: unknown;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err;
    }
    // (remediation's trailing markReady call throws -- see the NOTE in
    // orchestratorService.review.test.ts; irrelevant to what this test checks.)
    expect(caught).toBeDefined();

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("AI Code Review"),
    )![1] as string;
    expect(comment).toContain("(a.ts:42)");
  });
});

describe("OrchestratorService.retryRun -- repo fallback", () => {
  it("falls back to the default repo when getRepoByName returns null", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      planVersion: 1,
      branchName: null,
      repo: "unknown-repo",
    });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent, repoRegistry, gitService } =
      buildStoreDeps(initialRun);
    repoRegistry.getRepoByName.mockReturnValue(null);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () => makePlan({ planVersion: 1, openQuestions: [] }));
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith("/tmp", "run-1", "main", expect.any(String));
  });
});

describe("OrchestratorService.runExecution -- operator note", () => {
  it("passes the operator note through to the executor agent", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () => makeExecutionReport());
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1", { note: "focus on the auth module" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on the auth module" },
    );
  });
});

describe("OrchestratorService.answerQuestions -- prior researched answers are preserved on re-plan", () => {
  it("includes priorResearched.answers when a ResearchedAnswers artifact already exists", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } }),
      makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          answers: [{ questionId: "q2", question: "q", answer: "a", confidence: "medium" }],
          completedAt: new Date().toISOString(),
        },
      }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () => makePlan({ planVersion: 2, openQuestions: [] }));
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
      }),
    );
  });
});

describe("OrchestratorService simple getters", () => {
  it("expose the injected repositories and clients", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildStoreDeps(makeRun());
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when not configured", () => {
    const { deps } = buildStoreDeps(makeRun());
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.rejectPlan -- iterate-mode context injection", () => {
  it("injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings from loadReplanContext", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const priorPlan = makePlan({ planVersion: 2 });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: priorPlan }),
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

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.rejectPlan("run-1", "Needs OAuth2", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: { summary: "review summary", findings: [expect.objectContaining({ id: "f1" })] },
      }),
    );
  });

  it("fresh mode does not call loadReplanContext (no previousPlan/humanAnswers/researchedAnswers injected)", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.rejectPlan("run-1", "Start over", "api", "fresh");

    const callArgs = plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callArgs.previousPlan).toBeUndefined();
    expect(callArgs.humanAnswers).toBeUndefined();
    expect(callArgs.researchedAnswers).toBeUndefined();
  });

  it("pauses for clarification when the re-plan after rejection still has blocking open questions", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, () =>
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const result = await svc.rejectPlan("run-1", "feedback", "api");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.PLAN_CREATED, RunEvent.NEEDS_HUMAN_CLARIFICATION]),
    );
  });
});

describe("OrchestratorService.answerQuestions -- additional error/boundary paths", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when no TaskBundle artifact exists after clarification is provided", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("re-enters HumanClarificationNeeded with an incremented iteration count when blockers remain but the max has not been reached", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, store, plannerAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } }),
    ]);
    const svc = new OrchestratorService(deps as never);

    // One prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    store.events.push({
      id: "evt-0",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });

    wirePlannerAgent(artifactRepo, plannerAgent, () =>
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "not sure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationEvents = store.events.filter((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(clarificationEvents).toHaveLength(2);
    const latest = clarificationEvents[clarificationEvents.length - 1];
    expect((latest.payloadJson as { iteration?: number }).iteration).toBe(2);
  });
});

describe("OrchestratorService.maybeResearchAndReplan -- humanAnswers forwarded to the researcher and re-plan", () => {
  it("includes prior humanAnswers in both the researcher call and the re-plan call", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q0", answer: "prior answer" }] },
      }),
    ]);
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        answers: [{ questionId: "q1", question: "q", answer: "researched answer", confidence: "high" }],
        completedAt: new Date().toISOString(),
      }),
    };
    const svc = new OrchestratorService({ ...deps, answerResearcherAgent } as never);

    let call = 0;
    wirePlannerAgent(artifactRepo, plannerAgent, () => {
      call += 1;
      // First call (from rejectPlan's initial re-plan): still has an open
      // question so maybeResearchAndReplan fires. Second call (the research
      // re-plan): resolve it.
      return call === 1
        ? makePlan({ planVersion: 3, openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] })
        : makePlan({ planVersion: 4, openQuestions: [] });
    });
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.rejectPlan("run-1", "feedback", "api");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q0", answer: "prior answer" }] },
    );
    // The second plannerAgent.run call (post-research re-plan) should also carry humanAnswers.
    const secondCallOpts = plannerAgent.run.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(secondCallOpts.humanAnswers).toEqual([{ questionId: "q0", answer: "prior answer" }]);
  });
});

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("uses the remote default branch and warns when it differs from config", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, logger, plannerAgent, artifactRepo, planReviewerAgent, githubClient } = buildStoreDeps(
      initialRun,
      [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    );
    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanning("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    expect(plannerAgent.run.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "trunk" }) }),
    );
  });

  it("falls back to the configured default branch when GitHub lookup throws", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const { deps, logger, plannerAgent, artifactRepo, planReviewerAgent, githubClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("rate limited"));
    const svc = new OrchestratorService(deps as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanning("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "rate limited" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(plannerAgent.run.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
    );
  });
});

describe("OrchestratorService -- Execution Report comment formatting edge cases", () => {
  it("renders with no 'Files changed' section when nothing changed", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () => makeExecutionReport({ filesChanged: [], notes: [] }));
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });

  it("collapses the file list inside <details> when more than 8 files changed, and includes notes", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    wireExecutorAgent(artifactRepo, executorAgent, () =>
      makeExecutionReport({ filesChanged: manyFiles, notes: ["Heads up: large refactor"] }),
    );
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Heads up: large refactor");
  });

  it("shows a flat (non-collapsed) list when 8 or fewer files changed", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      planVersion: 1,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, executorAgent, reviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wireExecutorAgent(artifactRepo, executorAgent, () =>
      makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"], notes: [] }),
    );
    wireReviewerAgent(artifactRepo, reviewerAgent, () => ({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    }));

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("<details>");
    expect(comment).toContain("Files changed (2)");
  });
});

describe("OrchestratorService -- skill retrieval and metrics", () => {
  it("retrieveSkillsForPlanning records a SKILL_INJECTION event when skills are found and injects priorSkills into the planner call", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.AwaitingPlanApproval,
      planVersion: 2,
      linearIssueTitle: "Fix the thing",
    });
    const skillDoc = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Fix things",
      description: "desc",
      taskCategory: "bugfix",
      skillMarkdown: "# markdown",
      utilityScore: 1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skillDoc]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.rejectPlan("run-1", "feedback", "api");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.stringContaining("Fix the thing"), expect.any(Number));
    expect(store.events.some((e) => e.eventType === "SKILL_INJECTION")).toBe(true);
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [skillDoc] }),
    );
  });

  it("retrieveSkillsForPlanning does NOT record a SKILL_INJECTION event when no skills are found", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, store, plannerAgent, artifactRepo, planReviewerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    wirePlannerAgent(artifactRepo, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    await svc.rejectPlan("run-1", "feedback", "api");

    expect(store.events.some((e) => e.eventType === "SKILL_INJECTION")).toBe(false);
  });

  it("updateSkillMetrics increments success and archives-if-low-utility for every injected skill when the run completes (Done)", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockImplementation((id: string) => Promise.resolve({ id })),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, store } = buildStoreDeps(initialRun);
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a", "skill-b"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics increments failure for injected skills when the run fails, deduplicates ids across multiple injection events, and logs (but swallows) a per-skill error", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce({ id: "skill-b" }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, store, logger, plannerAgent } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } }),
    ]);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    // Two injection events referencing an overlapping skill id -- "skill-a"
    // should only be updated once.
    store.events.push(
      {
        id: "evt-skill-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a"] },
        createdAt: new Date(),
      },
      {
        id: "evt-skill-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
        createdAt: new Date(),
      },
      { id: "evt-c1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "evt-c2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "evt-c3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    );
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "db down" }),
      "Failed to update skill metric",
    );
    // archiveIfLowUtility is only reached for the id that didn't throw.
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });

  it("updateSkillMetrics is a no-op when there were no SKILL_INJECTION events", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});
