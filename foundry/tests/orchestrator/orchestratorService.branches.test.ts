import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Planning,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
    reviewId: "pr-1",
    summary: "Solid plan",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

/** Store-backed runRepo so real stateMachine.transition() sees a consistent
 * run.state across a multi-step flow (see planFlow.test.ts for rationale). */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: { run: Run } = { run: initialRun };

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
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
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

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
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
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "default-repo",
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
    }),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const answerResearcherAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
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
      answerResearcherAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    gitService,
    logger,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    answerResearcherAgent,
    executorAgent,
    reviewerAgent,
    store,
  };
}

describe("OrchestratorService trivial accessors", () => {
  it("expose the wired repositories and client", () => {
    const { deps, runRepo, artifactRepo, eventRepo } = buildDeps(makeRun());
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("exposes agentSkillRepo when configured", () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const { deps } = buildDeps(makeRun(), { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.startRun short-circuit", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    const { deps, runRepo } = buildDeps(existing);
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun repo resolution fallback", () => {
  it("falls back to the default repo when getRepoByName returns nothing", async () => {
    const { deps, repoRegistry, artifactRepo, plannerAgent, gitService } = buildDeps(
      makeRun({ state: RunState.Todo, branchName: null }),
    );
    const svc = new OrchestratorService(deps as never);

    repoRegistry.getRepoByName.mockReturnValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main", // default-repo's defaultBranch
      "ai/lin-1",
    );
  });
});

describe("OrchestratorService.rejectPlan blocking-question and iterate-context branches", () => {
  it("re-injects prior humanAnswers, researchedAnswers, and planReviewFindings, and pauses for clarification when the re-plan still blocks", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 2 }) }));
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 2, feedback: "Try again", source: "api", mode: "iterate" },
          }),
        );
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
              completedAt: new Date().toISOString(),
            },
          }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: { summary: "prior review", findings: [] } }),
        );
      return Promise.resolve(null);
    });

    const stillBlocked = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlocked);

    const result = await svc.rejectPlan("run-1", "Try again", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 2, feedback: "Try again" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q1" })],
        planReviewFindings: { summary: "prior review", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions remaining branches", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact after transitioning to Planning", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
            }),
          }),
        );
      return Promise.resolve(null); // TaskBundle missing
    });

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("loops back to HumanClarificationNeeded (not Failed) when blockers remain but the iteration cap has not been reached", async () => {
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(
      makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      { answerResearcherAgent: undefined },
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
            }),
          }),
        );
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "T", description: "d", labels: [], priority: 0 },
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
      return Promise.resolve(null); // no ResearchedAnswers
    });

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      }),
    );

    // Only one prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runManualPlanRevision missing plan artifact", () => {
  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanning with a ResearchedAnswers artifact present", () => {
  it("forwards prior researchedAnswers into the re-plan call", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.Planning, planVersion: 1 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "medium" }],
              completedAt: new Date().toISOString(),
            },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [expect.objectContaining({ questionId: "q1" })],
      }),
    );
  });
});

describe("OrchestratorService.maybeResearchAndReplan with prior HumanAnswers present", () => {
  it("forwards existing human answers to both the researcher and the re-plan call", async () => {
    const { deps, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps(
      makeRun({ state: RunState.Planning, planVersion: 1 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      return Promise.resolve(null);
    });

    // First planner call returns a plan with an open (non-blocking) question, which
    // triggers maybeResearchAndReplan; second call is the post-research re-plan.
    plannerAgent.run
      .mockResolvedValueOnce(
        makePlan({ openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }] }),
      )
      .mockResolvedValueOnce(makePlan({ planVersion: 2, openQuestions: [] }));

    answerResearcherAgent.run.mockResolvedValue({
      summary: "resolved",
      answers: [{ questionId: "q1", question: "Optional?", answer: "sure", confidence: "high", sources: [] }],
      completedAt: new Date().toISOString(),
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "yes" }] }),
    );
    expect(plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "yes" }] }),
    );
  });
});

describe("OrchestratorService.buildTaskBundle error-branch message coercion", () => {
  it("coerces a non-Error rejection from getDefaultBranch to a string message", async () => {
    const { deps, artifactRepo, githubClient, planReviewerAgent, logger } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    githubClient.getDefaultBranch.mockRejectedValue("network exploded");
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanReview("run-1");

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to resolve default branch"),
    );
    expect((warnCall?.[0] as { error: string }).error).toBe("network exploded");
  });

  it("coerces a non-Error rejection from getRelatedContext to a string message", async () => {
    const { deps, artifactRepo, linearClient, planReviewerAgent, logger } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    linearClient.getRelatedContext.mockRejectedValue("linear exploded");
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanReview("run-1");

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to fetch related Linear context"),
    );
    expect((warnCall?.[0] as { error: string }).error).toBe("linear exploded");
  });
});

describe("OrchestratorService.formatPlanComment omitted-section branches", () => {
  it("omits the Open Questions and Risks sections and the *blocks execution* suffix for a non-blocking question", async () => {
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ openQuestions: [], risks: [] }) }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanReview("run-1");

    const commentCall = linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan (v"),
    );
    expect(commentCall?.[1]).not.toContain("Open Questions");
    expect(commentCall?.[1]).not.toContain("Risks");
  });

  it("does not append the blocks-execution suffix for a non-required open question", async () => {
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({
        type: "Plan",
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Nice to know?", requiredForExecution: false }],
        }),
      }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    await svc.runPlanReview("run-1");

    const commentCall = linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan (v"),
    );
    expect(commentCall?.[1]).toContain("Nice to know?");
    expect(commentCall?.[1]).not.toContain("*blocks execution*");
  });
});

describe("OrchestratorService.formatPlanReviewComment affectedStepId branch", () => {
  it("includes the affected step id when a finding names one", async () => {
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "risk",
            affectedStepId: "s1",
            title: "Missing validation",
            details: "Step 1 needs input validation",
          },
        ],
      }),
    );
    vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    const commentCall = linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    );
    expect(commentCall?.[1]).toContain("(step s1)");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning empty-title/description branch", () => {
  it("builds the relevance query from empty strings when title and description are both null", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const run = makeRun({
      state: RunState.Todo,
      linearIssueTitle: null,
      linearIssueDescription: null,
      branchName: null,
    });
    const { deps, repoRegistry, artifactRepo, plannerAgent } = buildDeps(run, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    repoRegistry.resolveForIssue.mockReturnValue({
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
    repoRegistry.resolveWorkingDirectory.mockReturnValue("/tmp");
    repoRegistry.validateWorkingDirectory.mockReturnValue(undefined);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(run);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", expect.any(Number));
  });
});

describe("OrchestratorService.updateSkillMetrics tolerates a missing skillIds array", () => {
  it("treats a SKILL_INJECTION event with no skillIds as contributing none", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, eventRepo } = buildDeps(run, { agentSkillRepo, distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([makeEvent({ eventType: "SKILL_INJECTION", payloadJson: {} })]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.rejectPlan in 'fresh' mode", () => {
  it("skips loadReplanContext entirely and re-plans from feedback alone", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "RejectionContext") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
  });
});

describe("OrchestratorService.answerQuestions with prior ResearchedAnswers present", () => {
  it("forwards prior researched answers into the human-answers re-plan call", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      { answerResearcherAgent: undefined },
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
            }),
          }),
        );
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "T", description: "d", labels: [], priority: 0 },
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
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
              completedAt: new Date().toISOString(),
            },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [expect.objectContaining({ questionId: "q1" })],
      }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision without an operator note", () => {
  it("calls runPlanRevision with undefined opts when changes are requested and no note was given", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );
    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview distillation failure message coercion", () => {
  it("coerces a non-Error rejection from the distillation agent to a string message", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, logger } = buildDeps(run, { distillationAgent: { run: vi.fn().mockRejectedValue("boom") } });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect((warnCall?.[0] as { error: string }).error).toBe("boom");
  });
});

describe("OrchestratorService.updateSkillMetrics error-message coercion", () => {
  it("coerces a non-Error rejection from incrementSuccess to a string message", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue("boom"),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, eventRepo, logger } = buildDeps(run, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
    ]);

    await svc.approveHumanReview("run-1");

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect((warnCall?.[0] as { error: string }).error).toBe("boom");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning with a non-null description", () => {
  it("includes a slice of the issue description in the relevance query", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const run = makeRun({
      state: RunState.Todo,
      linearIssueTitle: "Fix the widget",
      linearIssueDescription: "A very detailed description of the bug.",
      branchName: null,
    });
    const { deps, repoRegistry, artifactRepo, plannerAgent } = buildDeps(run, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    repoRegistry.resolveForIssue.mockReturnValue({
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
    repoRegistry.resolveWorkingDirectory.mockReturnValue("/tmp");
    repoRegistry.validateWorkingDirectory.mockReturnValue(undefined);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(run);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("A very detailed description"),
      expect.any(Number),
    );
  });
});

describe("OrchestratorService.formatExecutionReportComment remaining branches", () => {
  it("uses the neutral icon for a 'skip' check status and omits the files section when nothing changed", async () => {
    const { deps, artifactRepo, executorAgent, linearClient } = buildDeps(
      makeRun({
        state: RunState.Implementing,
        prNumber: null,
        branchName: null,
        approvedPlanVersion: 1,
      }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        filesChanged: [],
        checks: {
          lint: { status: "skip", details: "no lint configured" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
      prNumber: 3,
    });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const commentCall = linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(commentCall?.[1]).toContain(":heavy_minus_sign:");
    expect(commentCall?.[1]).not.toContain("Files changed");
  });

  it("uses the failure icon for a 'fail' check status", async () => {
    const { deps, artifactRepo, executorAgent, linearClient } = buildDeps(
      makeRun({
        state: RunState.Implementing,
        prNumber: null,
        branchName: null,
        approvedPlanVersion: 1,
      }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "1 test failing" },
        },
      }),
      prNumber: 4,
    });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const commentCall = linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(commentCall?.[1]).toContain(":x:");
  });
});
