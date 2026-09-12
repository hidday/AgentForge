import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version ?? 1}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
}

function buildDeps(store: TestStore) {
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
    create: vi
      .fn()
      .mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          type: params.type as Artifact["type"],
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(
        matching.reduce((best, cur) => (cur.version > best.version ? cur : best)),
      );
    }),
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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const answerResearcherAgent = { run: vi.fn() };
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
      answerResearcherAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
    },
    plannerAgent,
    answerResearcherAgent,
    eventRepo,
  };
}

describe("OrchestratorService.maybeResearchAndReplan -- prior HumanAnswers forwarded", () => {
  it("includes existing HumanAnswers in both the researcher call and the post-research re-plan call", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q0", answer: "previously answered" }] },
        }),
      ],
    };
    const { deps, plannerAgent, answerResearcherAgent, eventRepo } = buildDeps(store);

    // 1st plannerAgent.run call: rejectPlan's own re-plan, returns a plan with a
    // (non-blocking) open question so maybeResearchAndReplan triggers research.
    // 2nd call: the internal re-plan inside maybeResearchAndReplan.
    plannerAgent.run
      .mockResolvedValueOnce(
        makePlan({
          planVersion: 2,
          openQuestions: [{ id: "q1", question: "Nice to know?", requiredForExecution: false }],
        }),
      )
      .mockResolvedValueOnce(makePlan({ planVersion: 3, openQuestions: [] }));

    answerResearcherAgent.run.mockResolvedValue({
      summary: "Researched",
      answers: [
        { questionId: "q1", question: "Nice to know?", answer: "Sure", confidence: "high" },
      ],
      completedAt: new Date().toISOString(),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", undefined, "api", "fresh");

    // The researcher call must have received the prior HumanAnswers.
    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q0", answer: "previously answered" }] }),
    );

    // The post-research re-plan call (2nd plannerAgent.run call) must also carry
    // the prior HumanAnswers alongside the fresh researchedAnswers.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q0", answer: "previously answered" }],
        researchedAnswers: expect.arrayContaining([
          expect.objectContaining({ questionId: "q1" }),
        ]),
      }),
    );

    const eventTypes = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("RESEARCH_COMPLETED");
  });
});
