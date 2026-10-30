import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
    summary: "Re-plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
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

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...current, state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  // Default: no stored artifacts of any type (overridable per-test).
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
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
      description: "desc",
      branchName: "ai/run-1",
      labels: [] as string[],
      priority: 0,
      url: null,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
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
    githubClient,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(undefined as unknown as Run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow(/Run not found/);
  });

  it("re-plans from scratch (no prior artifacts) and proceeds to plan review when no blockers", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    // No rejection/previousPlan/humanAnswers/researchedAnswers/planReview context, so
    // none of those optional keys should be present on the options object.
    const options = plannerAgent.run.mock.calls[0]![2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("previousPlan");
    expect(options).not.toHaveProperty("humanFeedback");
    expect(options).not.toHaveProperty("humanAnswers");
    expect(options).not.toHaveProperty("researchedAnswers");
    expect(options).not.toHaveProperty("planReviewFindings");

    expect(artifactRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: "TaskBundle" }));
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2, plannerRuntime: "claude-code" });
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("does not create a duplicate TaskBundle artifact when one already exists", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "TaskBundle" ? makeArtifact({ type: "TaskBundle" }) : null),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(artifactRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "TaskBundle" }),
    );
  });

  it("injects rejectionContext as humanFeedback when a RejectionContext artifact exists", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext") {
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "please simplify" },
          }),
        );
      }
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 1, feedback: "please simplify" },
      }),
    );
  });

  it("injects previousPlan when a Plan artifact exists", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    const previousPlan = makePlan({ planVersion: 1, summary: "Original plan" });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ type: "Plan", payloadJson: previousPlan }) : null),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ previousPlan }),
    );
  });

  it("injects humanAnswers when a non-empty HumanAnswers artifact exists", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    const answers = [{ questionId: "q1", answer: "Prod" }];
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(
        type === "HumanAnswers" ? makeArtifact({ type: "HumanAnswers", payloadJson: { answers } }) : null,
      ),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: answers }),
    );
  });

  it("does not inject humanAnswers when the HumanAnswers artifact has an empty answers array", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(
        type === "HumanAnswers" ? makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [] } }) : null,
      ),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    const options = plannerAgent.run.mock.calls[0]![2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("humanAnswers");
  });

  it("injects researchedAnswers when a non-empty ResearchedAnswers artifact exists", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    const researched = { answers: [{ questionId: "q1", answer: "x", confidence: "high" }] };
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(
        type === "ResearchedAnswers"
          ? makeArtifact({ type: "ResearchedAnswers", payloadJson: researched })
          : null,
      ),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ researchedAnswers: researched.answers }),
    );
  });

  it("injects planReviewFindings when a PlanReview artifact exists", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();
    const planReviewPayload = {
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(
        type === "PlanReview" ? makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }) : null,
      ),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planReviewFindings: { summary: "Needs work", findings: planReviewPayload.findings },
      }),
    );
  });

  it("pauses for human clarification when the re-plan has blocking open questions", async () => {
    const { deps, plannerAgent } = buildDeps();
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("does not pause when open questions exist but none are required for execution", async () => {
    const { deps, plannerAgent } = buildDeps();
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Nice to know?", requiredForExecution: false }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });
});
