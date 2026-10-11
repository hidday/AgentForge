import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

// This file closes the biggest remaining coverage gaps in orchestratorService.ts:
// simple getters that nothing calls, and four large methods that every other
// orchestratorService.*.test.ts file only ever spies over (so their own bodies
// never actually run): runPlanReview's "changes requested" branch + missing-plan
// guard, runPlanRevision end-to-end, approvePlan end-to-end, and runPlanning
// (the "retry planning" flow) across its several optional-context branches.
// It also covers a handful of small "no artifact found" guard clauses in
// sibling methods that were otherwise never exercised.

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "review-1",
    summary: "Looks reasonable",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
}

/**
 * Stateful run repo so sequential transitionAndRecord calls stay consistent,
 * following the convention in orchestratorService.startRetrySkills.test.ts.
 */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: TestStore = { run: initialRun };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };
  const repoEntry = {
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
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };
  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "review-1",
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed it" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
    deps: {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      gitService,
      repoRegistry,
      linearSync,
      githubSync,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    store,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    logger,
  };
}

describe("OrchestratorService getters", () => {
  it("expose the underlying repositories and clients passed in via deps", () => {
    const run = makeRun();
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
  });

  it("getAgentSkillRepo returns undefined when not configured, and the instance when it is", () => {
    const run = makeRun();
    const { deps } = buildDeps(run);
    const svcWithout = new OrchestratorService(deps as never);
    expect(svcWithout.getAgentSkillRepo()).toBeUndefined();

    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svcWith = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    expect(svcWith.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("transitions to PlanRevision and delegates to runPlanRevision when the verdict is changes_requested", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildDeps(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ type: "Plan", payloadJson: makePlan() }) : null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "risk",
            title: "Missing error handling",
            details: "Add a try/catch around the API call",
          },
        ],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const revisionResult = makeRun({ state: RunState.AwaitingPlanApproval });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisionResult);

    const result = await svc.runPlanReview("run-1");

    expect(result).toBe(revisionResult);
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commentCall[1]).toContain("Changes Requested");
    expect(commentCall[1]).toContain("Missing error handling");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, updates planVersion, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, artifactRepo, planReviserAgent, runRepo, linearClient } = buildDeps(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
          }),
        );
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      undefined,
    );
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("f1");
  });

  it("passes the operator note through to the plan reviser agent when provided", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, artifactRepo, planReviserAgent } = buildDeps(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ type: "Plan", payloadJson: makePlan() }) : null),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "Please simplify the auth flow" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "Please simplify the auth flow" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts the generic comment when no note is given", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const { deps, artifactRepo, runRepo, linearClient } = buildDeps(run);
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment and the transition payload when provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const { deps, artifactRepo, linearClient, eventRepo } = buildDeps(run);
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "Go ahead, looks solid" });

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("Go ahead, looks solid");

    const approvalEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((approvalEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "Go ahead, looks solid",
    );
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with only planVersionOverride when no optional context artifacts exist, and proceeds to plan review", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const { deps, plannerAgent } = buildDeps(run);
    // All findLatestByType calls already default to null (no Plan/HumanAnswers/etc).

    const svc = new OrchestratorService(deps as never);
    const reviewResult = makeRun({ state: RunState.PlanReview });
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(reviewResult);

    const result = await svc.runPlanning("run-1");

    expect(result).toBe(reviewResult);
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { planVersionOverride: 3 },
    );
  });

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings when all are present", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildDeps(run);
    const previousPlan = makePlan({ planVersion: 2, summary: "Previous plan" });
    const rejection = { planVersion: 2, feedback: "Use OAuth2", source: "api", mode: "iterate" };
    const humanAnswers = [{ questionId: "q1", answer: "Use Postgres" }];
    const researchedAnswers = [
      { questionId: "q2", question: "Which cache?", answer: "Redis", confidence: "high" as const },
    ];
    const planReview = {
      summary: "Needs more detail",
      findings: [
        { id: "f1", severity: "important", title: "Vague step", details: "Elaborate on step 2" },
      ],
    };
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(makeArtifact({ type: "RejectionContext", payloadJson: rejection }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({ type: "ResearchedAnswers", payloadJson: { answers: researchedAnswers } }),
        );
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers,
        researchedAnswers,
        planReviewFindings: planReview,
      }),
    );
  });

  it("pauses for human clarification instead of calling runPlanReview when the re-plan has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const { deps, plannerAgent } = buildDeps(run);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.rejectPlan (iterate mode, blocking questions on re-plan)", () => {
  it("loads full iterate context and pauses for human clarification when the re-plan still has blocking questions", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildDeps(run);
    const previousPlan = makePlan({ planVersion: 2, summary: "Previous plan" });
    const humanAnswers = [{ questionId: "q1", answer: "Use Postgres" }];
    const researchedAnswers = [
      { questionId: "q2", question: "Which cache?", answer: "Redis", confidence: "high" as const },
    ];
    const planReviewFindings = {
      summary: "Needs more detail",
      findings: [
        { id: "f1", severity: "important", title: "Vague step", details: "Elaborate on step 2" },
      ],
    };
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({ type: "ResearchedAnswers", payloadJson: { answers: researchedAnswers } }),
        );
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewFindings }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q3", question: "Which region?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "feedback text", "api", "iterate");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers,
        researchedAnswers,
        planReviewFindings,
      }),
    );
  });
});

describe("OrchestratorService.answerQuestions additional guard/branch coverage", () => {
  it("throws when the HumanClarificationNeeded re-plan finds no TaskBundle artifact", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo } = buildDeps(run);
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ type: "Plan", payloadJson: plan }) : null),
    );

    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("re-transitions to HumanClarificationNeeded with the remaining blocking questions when under the iteration cap", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(run);
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
              repo: {
                name: "test-repo",
                defaultBranch: "main",
                workingBranch: "ai/run-1",
                repoPath: "/tmp",
                allowedPaths: [],
                protectedPaths: [],
              },
              constraints: {
                requiredChecks: [],
                maxFilesChanged: 10,
                maxDiffLines: 500,
                forbiddenPatterns: [],
                mustNotTouch: [],
              },
              definitionOfDone: [],
            },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
      }),
    );
    eventRepo.findByRunId.mockResolvedValue([]); // clarificationCount = 0, below MAX_CLARIFICATION_ITERATIONS

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const reclarifyEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(reclarifyEvent).toBeDefined();
    expect(
      (reclarifyEvent![0] as { payloadJson: { iteration: number; blockingQuestions: unknown[] } })
        .payloadJson.iteration,
    ).toBe(1);
    expect(
      (reclarifyEvent![0] as { payloadJson: { blockingQuestions: { id: string }[] } }).payloadJson
        .blockingQuestions,
    ).toEqual([{ id: "q2", question: "Which region?" }]);
  });
});

describe("OrchestratorService.runPlanning answer-research branch (via maybeResearchAndReplan)", () => {
  it("passes existing humanAnswers into the answer researcher and the follow-up re-plan when open questions remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildDeps(run);
    const humanAnswers = [{ questionId: "q0", answer: "Already answered" }];
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      return Promise.resolve(null);
    });
    // First call (the main re-plan) returns a plan with a non-blocking open question,
    // which triggers maybeResearchAndReplan; the second call is the post-research re-plan.
    plannerAgent.run
      .mockResolvedValueOnce(
        makePlan({
          planVersion: 3,
          openQuestions: [{ id: "q1", question: "Which cache?", requiredForExecution: false }],
        }),
      )
      .mockResolvedValueOnce(makePlan({ planVersion: 4, openQuestions: [] }));
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        answers: [
          { questionId: "q1", question: "Which cache?", answer: "Redis", confidence: "high" as const },
        ],
      }),
    };

    const svc = new OrchestratorService({ ...deps, answerResearcherAgent } as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 3 }),
      expect.anything(),
      "run-1",
      { humanAnswers },
    );
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 4,
        researchedAnswers: [
          { questionId: "q1", question: "Which cache?", answer: "Redis", confidence: "high" },
        ],
        humanAnswers,
      }),
    );
  });
});

describe("OrchestratorService skill metrics on a failed run (via answerQuestions clarification exhaustion)", () => {
  it("calls incrementFailure (not incrementSuccess) for skills injected on a run that ends Failed", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(run);
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
              repo: {
                name: "test-repo",
                defaultBranch: "main",
                workingBranch: "ai/run-1",
                repoPath: "/tmp",
                allowedPaths: [],
                protectedPaths: [],
              },
              constraints: {
                requiredChecks: [],
                maxFilesChanged: 10,
                maxDiffLines: 500,
                forbiddenPatterns: [],
                mustNotTouch: [],
              },
              definitionOfDone: [],
            },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still blocked", requiredForExecution: true }],
      }),
    );
    // 3 prior NEEDS_HUMAN_CLARIFICATION events (== MAX_CLARIFICATION_ITERATIONS) plus a
    // SKILL_INJECTION event, so the run is failed AND updateSkillMetrics has work to do.
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: null, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: null, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: null, createdAt: new Date() },
      {
        id: "e4",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    const updatedSkill = { id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });
});

describe("Other 'artifact not found' guard clauses", () => {
  it("answerQuestions throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("runManualReReview throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("runManualPlanRevision throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});
