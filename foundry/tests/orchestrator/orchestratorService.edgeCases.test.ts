import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
    ...overrides,
  };
}

function makeArtifact<T>(type: Artifact["type"], payload: T, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${type}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload as unknown,
    rawText: JSON.stringify(payload),
    createdAt: new Date(),
    ...overrides,
  };
}

const defaultRepoEntry = {
  name: "test-repo",
  defaultBranch: "main",
  allowedPaths: ["src/"],
  protectedPaths: [],
  constraints: {
    requiredChecks: [],
    maxFilesChanged: 50,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  },
};

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x",
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
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const answerResearcherAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

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
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    executorAgent,
    reviewerAgent,
    answerResearcherAgent,
    logger,
  };
}

describe("OrchestratorService simple getters", () => {
  it("exposes the injected dependencies", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("returns the agentSkillRepo when provided", () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const { deps } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode with full prior context", () => {
  it("injects previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const previousPlan = makePlan({ planVersion: 2 });
    const humanAnswers = [{ questionId: "q1", answer: "yes" }];
    const researchedAnswers = [
      { questionId: "q2", question: "Q?", answer: "A", confidence: "medium" as const },
    ];
    const planReviewFindings = {
      summary: "review",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };

    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", previousPlan));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact("HumanAnswers", { answers: humanAnswers }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(makeArtifact("ResearchedAnswers", { answers: researchedAnswers }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", planReviewFindings));
      if (type === "RejectionContext") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "please redo", "api", "iterate");

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

  it("pauses for clarification when the re-plan after rejection still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 })) // PLAN_CREATED
      .mockResolvedValueOnce(
        makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 3 }),
      ); // NEEDS_HUMAN_CLARIFICATION

    artifactRepo.findLatestByType.mockResolvedValue(null);

    const newPlan = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "still not right", "api", "fresh");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions -- additional edge cases", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists after re-planning is triggered", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded with an incremented iteration count when still blocked but under the max", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: defaultRepoEntry,
      constraints: defaultRepoEntry.constraints,
      definitionOfDone: [],
    };
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact("TaskBundle", taskBundle));
      return Promise.resolve(null);
    });

    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which env, still?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(
        makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      ); // NEEDS_HUMAN_CLARIFICATION (loop back)

    // Only ONE prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        payloadJson: expect.objectContaining({
          iteration: 2,
          blockingQuestions: [{ id: "q1", question: "Which env, still?" }],
        }),
      }),
    );
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService -- maybeResearchAndReplan with prior HumanAnswers present", () => {
  it("forwards existing human answers into both the researcher call and the re-plan call", async () => {
    const researcherMock = { run: vi.fn() };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({
      answerResearcherAgent: researcherMock,
    });
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }));

    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
    });
    const humanAnswers = [{ questionId: "q1", answer: "staging" }];
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: defaultRepoEntry,
      constraints: defaultRepoEntry.constraints,
      definitionOfDone: [],
    };

    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact("TaskBundle", taskBundle));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact("HumanAnswers", { answers: humanAnswers }));
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const researched = {
      summary: "researched",
      answers: [{ questionId: "q1", question: "Which env?", answer: "staging", confidence: "high" as const }],
      completedAt: new Date().toISOString(),
    };
    researcherMock.run.mockResolvedValue(researched);

    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValueOnce(plan).mockResolvedValueOnce(revisedPlan);

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }));

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(researcherMock.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { humanAnswers },
    );
    // The re-plan call inside maybeResearchAndReplan is the second plannerAgent.run call.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers, researchedAnswers: researched.answers }),
    );
    void eventRepo;
  });
});

describe("OrchestratorService -- formatExecutionReportComment branches (via runExecution)", () => {
  function setupExecutionSuccess(overrides: Record<string, unknown> = {}) {
    const built = buildDeps(overrides);
    const svc = new OrchestratorService(built.deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    built.runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    built.artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    built.runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 1 }));
    built.runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    return { svc, ...built };
  }

  it("omits the files-changed section when no files changed, and includes notes when present", async () => {
    const { svc, executorAgent, linearClient } = setupExecutionSuccess();
    const report = makeExecutionReport({ filesChanged: [], notes: ["Watch out for X"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      (call[1] as string).includes("Execution Report"),
    )?.[1] as string;

    expect(comment).not.toContain("Files changed");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for X");
  });

  it("collapses the files-changed section inside <details> when more than 8 files changed", async () => {
    const { svc, executorAgent, linearClient } = setupExecutionSuccess();
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      (call[1] as string).includes("Execution Report"),
    )?.[1] as string;

    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });

  it("renders fail and skip check icons", async () => {
    const { svc, executorAgent, linearClient } = setupExecutionSuccess();
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "lint broke" },
        typecheck: { status: "skip", details: "skipped" },
        tests: { status: "pass", details: "ok" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      (call[1] as string).includes("Execution Report"),
    )?.[1] as string;

    expect(comment).toContain(":x:");
    expect(comment).toContain(":heavy_minus_sign:");
  });
});

describe("OrchestratorService -- formatCodeReviewComment lineHint branch (via runReview)", () => {
  it("includes the lineHint when present on a finding", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 5, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", makePlan()));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "s",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "src/a.ts", lineHint: 42, title: "Bad", details: "fix" },
      ],
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      (call[1] as string).includes("AI Code Review"),
    )?.[1] as string;

    expect(comment).toContain("(src/a.ts:42)");
  });
});
