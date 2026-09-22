import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makeExecutionReport,
  makePlan,
  makePlanReview,
  makeRun,
  makeTaskBundle,
  pushEvent,
} from "./testSupport.js";

describe("OrchestratorService.rejectPlan iterate-mode context injection", () => {
  it("forwards previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
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
          answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "medium" }],
          completedAt: "2026-01-01T00:00:00Z",
        },
      }),
      makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "prior review summary", findings: [] },
      }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "iterate please", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: { summary: "prior review summary", findings: [] },
      }),
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning query construction", () => {
  it("falls back to empty strings when linearIssueTitle/linearIssueDescription are null", async () => {
    const run = makeRun({
      state: RunState.Todo,
      branchName: "ai/existing",
      planVersion: 1,
      linearIssueTitle: null,
      linearIssueDescription: null,
    });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    const skillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    plannerAgent.run.mockImplementation(() => {
      store.artifacts.push(
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1, openQuestions: [] }) }),
      );
      return Promise.resolve(makePlan({ planVersion: 1, openQuestions: [] }));
    });
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);
    await svc.retryRun("run-1");

    expect(skillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", expect.any(Number));
  });
});

describe("OrchestratorService.maybeResearchAndReplan humanAnswers injection", () => {
  it("passes prior HumanAnswers into both the researcher call and the re-plan call", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "staging" }] },
      }),
    ]);
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        answers: [
          { questionId: "q1", question: "Which env?", answer: "staging", confidence: "high" },
        ],
        completedAt: "2026-01-01T00:00:00Z",
      }),
    };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, { answerResearcherAgent });
    planReviewerAgent.run.mockResolvedValue(makePlanReview());
    const initialPlan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run
      .mockImplementationOnce(() => Promise.resolve(initialPlan))
      .mockImplementationOnce(() => {
        store.artifacts.push(
          makeArtifact({ type: "Plan", version: revisedPlan.planVersion, payloadJson: revisedPlan }),
        );
        return Promise.resolve(revisedPlan);
      });

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "staging" }] },
    );
    // Second plannerAgent.run call is the post-research re-plan.
    expect(plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(plannerAgent.run.mock.calls[1][2]).toEqual(
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "staging" }] }),
    );
  });
});

describe("OrchestratorService.formatPlanComment with risks and open questions", () => {
  it("includes the Risks section when the approved plan has risks", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          planVersion: 1,
          risks: ["Rate limits may be hit", "Third-party API instability"],
        }),
      }),
    ]);
    const { deps, planReviewerAgent, linearClient } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Rate limits may be hit");
  });
});

describe("OrchestratorService.formatExecutionReportComment 'skip' check status icon", () => {
  it("renders the neutral icon for a 'skip' check status", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "eslint errors" },
          typecheck: { status: "skip", details: "not configured" },
          tests: { status: "pass", details: "ok" },
        },
      }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain(":heavy_minus_sign: **Typecheck** -- not configured");
    expect(comment).toContain(":x: **Lint** -- eslint errors");
  });
});

describe("OrchestratorService.updateSkillMetrics edge cases", () => {
  it("treats a missing skillIds array on an injection event as empty (no crash, no metric calls for it)", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:01Z"),
      payloadJson: {}, // no skillIds field
    });
    const { deps } = buildDeps(store);
    const skillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(skillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("increments failure and archives normally (no throw) when a run reaches Failed", async () => {
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
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:01Z"),
      payloadJson: { skillIds: ["skill-1"] },
    });
    for (let i = 0; i < 3; i++) {
      pushEvent(store, {
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        createdAt: new Date(`2026-01-01T00:00:0${i + 2}Z`),
        payloadJson: {},
      });
    }

    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still which env?", requiredForExecution: true }],
      }),
    );
    const skillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.4 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(skillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(skillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1", utilityScore: 0.4 });
  });

  it("stringifies a non-Error thrown while updating a skill metric", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:01Z"),
      payloadJson: { skillIds: ["skill-1"] },
    });
    const { deps, logger } = buildDeps(store);
    const skillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue("plain string boom"),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "skill-1", error: "plain string boom" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService.buildTaskBundle error-normalization branches", () => {
  it("falls back to the configured default branch and logs the error message when getDefaultBranch throws an Error", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, githubClient, planReviewerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub API down"));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub API down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    const bundleArg = planReviewerAgent.run.mock.calls[0][1] as { repo: { defaultBranch: string } };
    expect(bundleArg.repo.defaultBranch).toBe("main");
  });

  it("stringifies a non-Error thrown by getDefaultBranch", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, githubClient, planReviewerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockRejectedValue("not-an-error-either");
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "not-an-error-either" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("stringifies a non-Error thrown by getRelatedContext", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, linearClient, planReviewerAgent, logger } = buildDeps(store);
    linearClient.getRelatedContext.mockRejectedValue("not-an-error");
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "not-an-error" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});
