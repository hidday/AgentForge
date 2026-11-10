import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "A fairly long description that will be truncated by the skill query builder",
    linearIssueTitle: "Title",
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good.",
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
  opts: {
    artifacts?: Record<string, unknown>;
    events?: RunEventRecord[];
    agentSkillRepo?: Record<string, unknown>;
  } = {},
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

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 42 }),
  };
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
      ...(opts.agentSkillRepo ? { agentSkillRepo: opts.agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    plannerAgent,
    logger,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService -- retrieveSkillsForPlanning (via startRun)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not query skills or emit SKILL_INJECTION when no agentSkillRepo is configured", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    const injectionCalls = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCalls).toHaveLength(0);
  });

  it("queries top-K skills by relevance and emits a SKILL_INJECTION event with the matched skill ids", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", taskCategory: "api", skillMarkdown: "# Skill" },
        { id: "skill-2", repoSlug: "test-repo", taskCategory: "api", skillMarkdown: "# Skill 2" },
      ]),
    };
    const built = buildDeps(makeRun(), { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Title"),
      expect.any(Number),
    );
    const injectionCall = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    )!;
    const payload = (injectionCall[0] as { payloadJson: { skillIds: string[] } }).payloadJson;
    expect(payload.skillIds).toEqual(["skill-1", "skill-2"]);
  });

  it("does not emit SKILL_INJECTION when the skill query returns zero results", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const built = buildDeps(makeRun(), { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    const injectionCalls = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCalls).toHaveLength(0);
  });
});

describe("OrchestratorService -- maybeResearchAndReplan (via startRun)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a prior HumanAnswers artifact into both the researcher and the post-research re-plan call", async () => {
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "Researched",
        answers: [{ questionId: "q1", question: "x", answer: "y", confidence: "high" }],
      }),
    };
    const built = buildDeps(makeRun(), {
      artifacts: {
        HumanAnswers: { payloadJson: { answers: [{ questionId: "q1", answer: "staging" }] } },
      },
    });
    built.plannerAgent.run
      .mockResolvedValueOnce(
        makePlan({
          openQuestions: [{ id: "q1", question: "Non-blocking?", requiredForExecution: false }],
        }),
      )
      .mockResolvedValue(makePlan());
    const svc = new OrchestratorService({ ...built.deps, answerResearcherAgent } as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "staging" }] },
    );
    expect(built.plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "staging" }] }),
    );
  });
});

describe("OrchestratorService -- updateSkillMetrics (via transitions to Done/Failed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("increments success and archives-if-low-utility for every injected skill when a run completes (Done)", async () => {
    const updatedSkill = { id: "skill-1", utilityScore: 0.8 };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), {
      agentSkillRepo,
      events: [makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("deduplicates skill ids injected across multiple planning passes", async () => {
    const updatedSkill = { id: "skill-1", utilityScore: 0.8 };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), {
      agentSkillRepo,
      events: [
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ],
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(1);
  });

  it("increments failure for injected skills when a run fails (clarification exhausted)", async () => {
    const updatedSkill = { id: "skill-1", utilityScore: 0.2 };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(makeRun({ state: RunState.HumanClarificationNeeded }), {
      agentSkillRepo,
      artifacts: { Plan: { payloadJson: plan }, TaskBundle: { payloadJson: { issue: {}, repo: {} } } },
      events: [
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ],
    });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
  });

  it("logs a warning and continues when updating one skill's metric throws", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps(makeRun({ state: RunState.ReadyForHumanReview }), {
      agentSkillRepo,
      events: [makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } })],
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- formatExecutionReportComment (via runExecution)", () => {
  beforeEach(() => vi.clearAllMocks());

  function runExecutionWith(filesChanged: string[], notes: string[] = []) {
    const built = buildDeps(makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }), {
      artifacts: { Plan: { payloadJson: makePlan() } },
    });
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged, notes }),
      prNumber: 42,
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());
    return { built, svc };
  }

  it("omits the 'Files changed' section entirely when no files changed", async () => {
    const { built, svc } = runExecutionWith([]);
    await svc.runExecution("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]![1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("lists files inline (no <details>) when at or under the collapse threshold", async () => {
    const { built, svc } = runExecutionWith(["a.ts", "b.ts", "c.ts"]);
    await svc.runExecution("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]![1] as string;
    expect(comment).toContain("Files changed (3)");
    expect(comment).not.toContain("<details>");
  });

  it("collapses the file list inside <details> when over the collapse threshold", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `file${i}.ts`);
    const { built, svc } = runExecutionWith(files);
    await svc.runExecution("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]![1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });

  it("includes a Notes section only when notes are present", async () => {
    const withNotes = runExecutionWith(["a.ts"], ["Watch out for X"]);
    await withNotes.svc.runExecution("run-1");
    const commentWithNotes = (withNotes.built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]![1] as string;
    expect(commentWithNotes).toContain("### Notes");
    expect(commentWithNotes).toContain("Watch out for X");

    const withoutNotes = runExecutionWith(["a.ts"], []);
    await withoutNotes.svc.runExecution("run-1");
    const commentWithoutNotes = (withoutNotes.built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]![1] as string;
    expect(commentWithoutNotes).not.toContain("### Notes");
  });
});
