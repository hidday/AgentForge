import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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
    summary: "Implemented.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean.",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

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
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    planReviewerAgent,
    logger,
  };
}

describe("OrchestratorService.rejectPlan mode branches", () => {
  it("fresh mode: skips loadReplanContext and posts a 'fresh' comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, newPlan));
      return Promise.resolve(null);
    });
    deps.planReviewerAgent &&
      (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "ok",
        findings: [],
      });

    await svc.rejectPlan("run-1", "start over please", "api", "fresh");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Plan rejected"),
    );
    expect(comment![1]).toContain("Plan rejected (fresh) with feedback: start over please");

    // In fresh mode, no previousPlan/humanAnswers/researchedAnswers/planReviewFindings
    // should be injected from loadReplanContext (only the RejectionContext feedback).
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
  });

  it("iterate mode: injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings from prior artifacts", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const previousPlan = makePlan({ planVersion: 2 });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "yes" }];
    const researchedAnswers: ResearchedAnswers = {
      summary: "r",
      answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "review summary",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    const rejectionPayload: RejectionContextPayload = {
      planVersion: 2,
      feedback: "please adjust",
      source: "api",
      mode: "iterate",
    };

    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, previousPlan));
      if (type === "HumanAnswers") return Promise.resolve(asArtifact("HumanAnswers", 1, { answers: humanAnswers }));
      if (type === "ResearchedAnswers") return Promise.resolve(asArtifact("ResearchedAnswers", 1, researchedAnswers));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReviewPayload));
      if (type === "RejectionContext") return Promise.resolve(asArtifact("RejectionContext", 2, rejectionPayload));
      return Promise.resolve(null);
    });
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.rejectPlan("run-1", "please adjust", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "please adjust" },
        humanAnswers,
        researchedAnswers: researchedAnswers.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
  });
});

describe("OrchestratorService.answerQuestions additional error branches", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when no TaskBundle artifact exists for the HumanClarificationNeeded re-plan", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      // No TaskBundle artifact.
      return Promise.resolve(null);
    });

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("returns to HumanClarificationNeeded (not Failed) when still blocked and under the max iteration count", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still unclear", requiredForExecution: true }] }),
    );
    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: {}, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still not sure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const payload = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    )?.[0] as { payloadJson: { iteration: number } };
    expect(payload.payloadJson.iteration).toBe(2);
  });
});

describe("OrchestratorService.runManualPlanRevision additional error branch", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService answer-researcher humanAnswers injection branch", () => {
  it("includes prior HumanAnswers in both the researcher call and the post-research re-plan call", async () => {
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "resolved",
        answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
        completedAt: new Date().toISOString(),
      }),
    };
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps({ answerResearcherAgent });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, prNumber: null });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    (deps.repoRegistry as { resolveForIssue: ReturnType<typeof vi.fn> }).resolveForIssue.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry as { resolveWorkingDirectory: ReturnType<typeof vi.fn> }).resolveWorkingDirectory.mockReturnValue(
      "/tmp/repo",
    );
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue({ ...todoRun, state: RunState.Planning, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "yes" }];
    const planWithQuestion = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    const clearedPlan = makePlan({ planVersion: 2, openQuestions: [] });

    plannerAgent.run.mockResolvedValueOnce(planWithQuestion).mockResolvedValueOnce(clearedPlan);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers") return Promise.resolve(asArtifact("HumanAnswers", 1, { answers: humanAnswers }));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, clearedPlan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      planWithQuestion,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers }),
    );
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers, researchedAnswers: expect.anything() }),
    );
  });
});

describe("OrchestratorService comment formatting edge cases", () => {
  it("formatPlanComment includes the blocking-question marker and the risks section", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which approach?", requiredForExecution: true }],
      risks: ["Might break the build"],
    });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI plan review: approved"),
    )?.[1] as string;
    expect(comment).toContain("*blocks execution*");
    expect(comment).toContain("Might break the build");
  });

  it("formatExecutionReportComment collapses the file list behind <details> when over the threshold and includes notes", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5, approvedPlanVersion: 1 }));
    let execCallCount = 0;
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") {
        execCallCount += 1;
        if (execCallCount === 1) return Promise.resolve(null);
        return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      }
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
        );
      return Promise.resolve(null);
    });
    (deps.executorAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({ report, prNumber: 5 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 5 }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5 }));
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      reviewId: "r",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for X");
  });
});
