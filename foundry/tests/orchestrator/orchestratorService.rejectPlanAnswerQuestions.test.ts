import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { ValidationError } from "../../src/utils/errors.js";
import type { Run, RunEventRecord, HumanAnswer } from "../../src/domain/types.js";
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
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(
  initialRun: Run,
  opts: { artifacts?: Record<string, unknown>; events?: RunEventRecord[] } = {},
) {
  let currentRun = initialRun;
  const artifacts = new Map<string, unknown>(Object.entries(opts.artifacts ?? {}));

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      currentRun = { ...currentRun, ...params };
      return Promise.resolve(currentRun);
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; payloadJson: unknown }) => {
      const created = { id: `artifact-${params.type}`, ...params };
      artifacts.set(params.type, created);
      return Promise.resolve(created);
    }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockImplementation((_id: string, type: string) =>
        Promise.resolve(artifacts.get(type) ?? null),
      ),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main"),
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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan({ planVersion: 3 })) };
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    logger,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.startRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the existing active run immediately without creating a new one", async () => {
    const existing = makeRun({ id: "existing-run", state: RunState.Planning });
    const built = buildDeps(makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(built.runRepo.create).not.toHaveBeenCalled();
    expect(built.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("warns and uses the remote default branch when it differs from the configured one", async () => {
    const built = buildDeps(makeRun({ id: "run-1", state: RunState.Todo }));
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the config default branch (stringifying a non-Error rejection) when GitHub lookup fails", async () => {
    const built = buildDeps(makeRun({ id: "run-1", state: RunState.Todo }));
    built.githubClient.getDefaultBranch.mockRejectedValue("network down");
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("proceeds without relatedContext (stringifying a non-Error rejection) when getRelatedContext fails", async () => {
    const built = buildDeps(makeRun({ id: "run-1", state: RunState.Todo }));
    built.deps.linearClient.getRelatedContext = vi.fn().mockRejectedValue("linear outage");
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "linear outage" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService.rejectPlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mode='fresh': does not load prior plan/answers context before re-planning", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Plan rejected (fresh)");
  });

  it("mode='iterate' (default): injects the previous plan from loadReplanContext into the planner call", async () => {
    const priorPlan = makePlan({ planVersion: 2, summary: "Prior plan" });
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }), {
      artifacts: { Plan: { payloadJson: priorPlan } },
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "iterate please");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ previousPlan: priorPlan }),
    );
  });

  it("mode='iterate': injects prior HumanAnswers, ResearchedAnswers, and PlanReview findings via loadReplanContext into the planner call", async () => {
    const priorPlan = makePlan({ planVersion: 2 });
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }), {
      artifacts: {
        Plan: { payloadJson: priorPlan },
        HumanAnswers: { payloadJson: { answers: [{ questionId: "q1", answer: "staging" }] } },
        ResearchedAnswers: {
          payloadJson: {
            answers: [{ questionId: "q2", question: "x", answer: "y", confidence: "high" }],
          },
        },
        PlanReview: { payloadJson: { summary: "Needs tweaks", findings: [{ id: "f1" }] } },
      },
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.rejectPlan("run-1", "iterate please");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "staging" }],
        researchedAnswers: [{ questionId: "q2", question: "x", answer: "y", confidence: "high" }],
        planReviewFindings: { summary: "Needs tweaks", findings: [{ id: "f1" }] },
      }),
    );
  });

  it("pauses for human clarification (without calling runPlanReview) when the re-plan still has blocking questions", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "feedback");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions -- additional branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no Plan artifact exists for the run", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when the run has no TaskBundle artifact after re-planning with human answers", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }), {
      artifacts: { Plan: { payloadJson: plan } },
    });
    const svc = new OrchestratorService(built.deps as never);
    const answers: HumanAnswer[] = [{ questionId: "q1", answer: "staging" }];

    await expect(svc.answerQuestions("run-1", answers)).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("re-transitions to HumanClarificationNeeded (with incremented iteration) when blockers remain and the iteration limit is not yet reached", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }), {
      artifacts: { Plan: { payloadJson: plan }, TaskBundle: { payloadJson: { issue: {}, repo: {} } } },
      events: [makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION })],
    });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q2", question: "Still unclear", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const answers: HumanAnswer[] = [{ questionId: "q1", answer: "staging" }];

    const result = await svc.answerQuestions("run-1", answers);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationCall = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    )!;
    const payload = (clarificationCall[0] as { payloadJson: { iteration: number } }).payloadJson;
    expect(payload.iteration).toBe(2);
  });

  it("forwards a prior ResearchedAnswers artifact into the planner re-plan call alongside the new human answers", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }), {
      artifacts: {
        Plan: { payloadJson: plan },
        TaskBundle: { payloadJson: { issue: {}, repo: {} } },
        ResearchedAnswers: {
          payloadJson: {
            answers: [{ questionId: "q0", question: "x", answer: "y", confidence: "high" }],
          },
        },
      },
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [{ questionId: "q0", question: "x", answer: "y", confidence: "high" }],
      }),
    );
  });

  it("rejects with a ValidationError (not silently) when a required question is missing an answer", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }), {
      artifacts: { Plan: { payloadJson: plan } },
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(ValidationError);
  });
});
