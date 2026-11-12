import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    summary: "Implementation complete.",
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

function asEvent(eventType: string, payloadJson: unknown = {}): RunEventRecord {
  return {
    id: `event-${eventType}-${Math.random()}`,
    runId: "run-1",
    eventType,
    source: "orchestrator",
    payloadJson,
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
}

function buildDeps(initialRun: Run, store: TestStore, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const answerResearcherAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
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
      answerResearcherAgent,
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
    planReviserAgent,
    answerResearcherAgent,
    executorAgent,
    reviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService -- trivial dependency getters", () => {
  it("expose the underlying repositories and client passed into the constructor", () => {
    const initialRun = makeRun();
    const store: TestStore = { runState: RunState.Todo };
    const { deps } = buildDeps(initialRun, store, { agentSkillRepo: { marker: "skill-repo" } });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    expect(svc.getAgentSkillRepo()).toEqual({ marker: "skill-repo" });
  });

  it("getAgentSkillRepo returns undefined when no agentSkillRepo dependency was supplied", () => {
    const initialRun = makeRun();
    const store: TestStore = { runState: RunState.Todo };
    const { deps } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion from the latest Plan, transitions to Implementing, and posts a plain comment without a note", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, runRepo, linearClient, logger } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 3 });
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 3, plan));

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(result.state).toBe(RunState.Implementing);

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Plan v3 approved."),
    );
    expect(comment).toBeDefined();
    expect((comment![1] as string)).not.toContain("operator note");

    const infoCall = logger.info.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1] === "Plan approved",
    );
    expect((infoCall![0] as { hasOperatorNote: boolean }).hasOperatorNote).toBe(false);
  });

  it("includes the operator note in both the Linear comment and the PLAN_APPROVED event payload", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, linearClient, eventRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 4 });
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 4, plan));

    await svc.approvePlan("run-1", { note: "Keep it minimal" });

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("approved with operator note"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).toContain("Keep it minimal");

    const approvedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((approvedEvent![0] as { payloadJson: { note: string } }).payloadJson.note).toBe(
      "Keep it minimal",
    );
  });
});

describe("OrchestratorService.runPlanReview -- missing Plan artifact", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview });
    const store: TestStore = { runState: RunState.PlanReview };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.answerQuestions -- missing-artifact guards", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const store: TestStore = { runState: RunState.HumanClarificationNeeded };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists after transitioning to Planning", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const store: TestStore = { runState: RunState.HumanClarificationNeeded };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- missing Plan artifact", () => {
  it("runManualReReview throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("runManualPlanRevision throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode with full replan context", () => {
  it("injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings into the re-plan call", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, plannerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const previousPlan = makePlan({ planVersion: 2 });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, previousPlan));
      if (type === "HumanAnswers") {
        return Promise.resolve(
          asArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }),
        );
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          asArtifact("ResearchedAnswers", 1, {
            summary: "s",
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          }),
        );
      }
      if (type === "PlanReview") {
        return Promise.resolve(
          asArtifact("PlanReview", 1, { summary: "review summary", findings: [] }),
        );
      }
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.rejectPlan("run-1", "feedback text", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" },
        ],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking open questions", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, plannerAgent, planReviewerAgent, eventRepo } = buildDeps(
      initialRun,
      store,
      // No answer researcher configured, so the blocking question goes
      // straight to human clarification instead of a research pass.
      { answerResearcherAgent: undefined },
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);
    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Need input?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);

    const result = await svc.rejectPlan("run-1", "try again");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});

describe("OrchestratorService -- maybeResearchAndReplan forwards existing HumanAnswers", () => {
  it("includes humanAnswers in both the researcher call and the post-research planner call", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const planWithQuestions = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 3, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers") {
        return Promise.resolve(
          asArtifact("HumanAnswers", 1, {
            answers: [{ questionId: "q0", answer: "previously answered" }],
          }),
        );
      }
      // runPlanReview (chained at the end of rejectPlan, since the revised
      // plan has no blocking questions) re-reads the latest Plan artifact.
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 3, revisedPlan));
      return Promise.resolve(null);
    });
    plannerAgent.run
      .mockResolvedValueOnce(planWithQuestions)
      .mockResolvedValueOnce(revisedPlan);
    answerResearcherAgent.run.mockResolvedValue({
      summary: "Researched",
      answers: [
        { questionId: "q1", question: "Optional?", answer: "Yes", confidence: "high" },
      ],
      completedAt: "2026-01-01T00:00:00Z",
    });

    await svc.rejectPlan("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      planWithQuestions,
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q0", answer: "previously answered" }] },
    );

    // Second plannerAgent.run call is the post-research re-plan.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q0", answer: "previously answered" }],
        researchedAnswers: [
          { questionId: "q1", question: "Optional?", answer: "Yes", confidence: "high" },
        ],
      }),
    );
  });
});

describe("OrchestratorService -- formatExecutionReportComment branches (via runExecution)", () => {
  function setupRunExecution(
    initialRun: Run,
    store: TestStore,
    report: ExecutionReport,
  ) {
    const { deps, artifactRepo, executorAgent, reviewerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, {
        reviewId: "rev-1",
        summary: "ok",
        findings: [],
        overallVerdict: "approved",
      }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    return { svc, deps };
  }

  it("omits the files-changed and notes sections when both are empty", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 101 });
    const store: TestStore = { runState: RunState.Implementing };
    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    const { svc, deps } = setupRunExecution(initialRun, store, report);

    await svc.runExecution("run-1");

    const comment = (deps.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).not.toContain("Files changed");
    expect(comment![1] as string).not.toContain("### Notes");
  });

  it("collapses the file list into a <details> block when there are more files than the collapse threshold, and renders a skipped check icon and notes", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 101 });
    const store: TestStore = { runState: RunState.Implementing };
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({
      filesChanged: manyFiles,
      notes: ["Heads up: large refactor"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "skip", details: "not run" },
        tests: { status: "pass", details: "ok" },
      },
    });
    const { svc, deps } = setupRunExecution(initialRun, store, report);

    await svc.runExecution("run-1");

    const comment = (deps.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    const text = comment![1] as string;
    expect(text).toContain("<details>");
    expect(text).toContain("Files changed (9)");
    expect(text).toContain("### Notes");
    expect(text).toContain("Heads up: large refactor");
    expect(text).toContain(":heavy_minus_sign:");
  });
});

describe("OrchestratorService -- formatPlanComment risks section (via runPlanReview)", () => {
  it("includes a Risks section in the approved-plan comment when the plan lists risks", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview });
    const store: TestStore = { runState: RunState.PlanReview };
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ risks: ["Third-party API may rate-limit us"] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    await svc.runPlanReview("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("AI Plan"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).toContain("**Risks:**");
    expect(comment![1] as string).toContain("Third-party API may rate-limit us");
  });
});

describe("OrchestratorService -- formatPlanReviewComment affectedStepId (via runPlanReview changes_requested)", () => {
  it("includes the affected step id in a plan-review finding line when present", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview });
    const store: TestStore = { runState: RunState.PlanReview };
    const { deps, artifactRepo, linearClient, planReviewerAgent, planReviserAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing edge case",
          details: "Handle empty input",
        },
      ],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanReview("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).toContain("(step s1)");
  });
});

describe("OrchestratorService -- skill metric edge cases", () => {
  it("treats a SKILL_INJECTION event with no skillIds field as contributing zero skills", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildDeps(initialRun, store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    // Malformed/legacy event payload with no skillIds key at all.
    eventRepo.findByRunId.mockResolvedValue([asEvent("SKILL_INJECTION", {})]);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown value in the 'Failed to update skill metric' warning", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue("just a string rejection"),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo, logger } = buildDeps(initialRun, store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([asEvent("SKILL_INJECTION", { skillIds: ["skill-1"] })]);

    await svc.approveHumanReview("run-1");

    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("just a string rejection");
  });
});
