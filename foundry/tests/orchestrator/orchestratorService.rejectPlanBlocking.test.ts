import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

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
    planVersion: 3,
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

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 2,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(overrides: {
  run?: Run;
  newPlan?: Plan;
  rejectionArtifact?: Artifact | null;
} = {}) {
  const run = overrides.run ?? makeRun();
  const newPlan = overrides.newPlan ?? makePlan();
  const newPlanArtifact = makeArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan });
  const rejectionArtifact = overrides.rejectionArtifact;

  let currentRun: Run = { ...run };
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      currentRun = { ...currentRun, state };
      return Promise.resolve({ ...currentRun });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve({ ...currentRun });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(newPlanArtifact);
      if (type === "RejectionContext") {
        return Promise.resolve(rejectionArtifact === undefined ? null : rejectionArtifact);
      }
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
  };
  const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
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
    },
    run,
    runRepo,
    linearClient,
    plannerAgent,
  };
}

describe("OrchestratorService.rejectPlan -- blocking questions and fresh mode", () => {
  it("mode=fresh: transitions to HumanClarificationNeeded when the re-plan still has blocking questions", async () => {
    const newPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
    });
    const { deps, runRepo } = buildDeps({ newPlan });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "needs clarity", "api", "fresh");

    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("mode=fresh posts a '(fresh)' comment and does not load prior plan/answers context", async () => {
    const { deps, linearClient, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Plan rejected"),
    )![1] as string;
    expect(comment).toContain("(fresh)");
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
  });

  it("mode=fresh still injects humanFeedback from an existing RejectionContext (independent of iterate/fresh)", async () => {
    const rejectionArtifact = makeArtifact({
      type: "RejectionContext",
      version: 2,
      payloadJson: {
        planVersion: 2,
        feedback: "Use OAuth2",
        source: "api",
        mode: "fresh",
      } as RejectionContextPayload,
    });
    const { deps, plannerAgent } = buildDeps({ rejectionArtifact });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "Use OAuth2", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
      }),
    );
  });

  it("mode=iterate (default) with no blocking questions proceeds straight to plan review", async () => {
    const { deps } = buildDeps({ newPlan: makePlan({ openQuestions: [] }) });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "iterate please");

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("records the blockingQuestions payload on the NEEDS_HUMAN_CLARIFICATION event", async () => {
    const newPlan = makePlan({
      openQuestions: [
        { id: "q1", question: "Which env?", requiredForExecution: true },
        { id: "q2", question: "Nice to have?", requiredForExecution: false },
      ],
    });
    const { deps } = buildDeps({ newPlan });
    const svc = new OrchestratorService(deps as never);

    await svc.rejectPlan("run-1", "needs answers", "api", "fresh");

    const eventCall = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    const payload = (eventCall![0] as { payloadJson: { blockingQuestions: { id: string }[] } })
      .payloadJson;
    expect(payload.blockingQuestions).toEqual([{ id: "q1", question: "Which env?" }]);
  });
});
