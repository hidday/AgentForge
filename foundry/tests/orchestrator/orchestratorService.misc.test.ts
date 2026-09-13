import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, HumanAnswer, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";
import type { SkillDocument } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Some issue title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
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

function minimalDeps() {
  return {
    runRepo: { findById: vi.fn(), findActiveByIssueId: vi.fn(), findAll: vi.fn(), create: vi.fn(), findByIssueId: vi.fn(), updateState: vi.fn(), update: vi.fn() },
    artifactRepo: { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() },
    eventRepo: { create: vi.fn(), findByRunId: vi.fn().mockResolvedValue([]) },
    linearClient: { getIssue: vi.fn(), postComment: vi.fn() },
    githubClient: { getPRDiff: vi.fn() },
    gitService: { setupRunWorktree: vi.fn(), assertBranch: vi.fn(), commitAndPush: vi.fn(), removeWorktree: vi.fn(), resolveMainRepoPath: vi.fn() },
    repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
    linearSync: { syncState: vi.fn() },
    githubSync: { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
    plannerAgent: { run: vi.fn() },
    planReviewerAgent: { run: vi.fn() },
    planReviserAgent: { run: vi.fn() },
    executorAgent: { run: vi.fn() },
    reviewerAgent: { run: vi.fn() },
    remediationAgent: { run: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

describe("OrchestratorService accessor getters", () => {
  it("expose the injected repositories and Linear client", () => {
    const deps = minimalDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("returns the injected agentSkillRepo when configured", () => {
    const deps = minimalDeps();
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.startRun -- existing active run", () => {
  it("returns the existing active run without creating a new one", async () => {
    const deps = minimalDeps();
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(deps.runRepo.create).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
  });
});

// Full startRun flow, used to exercise retrieveSkillsForPlanning, the answer
// researcher's HumanAnswers injection branch, and general plumbing.
function buildStartRunDeps(overrides: {
  plan?: Plan;
  agentSkillRepo?: Record<string, ReturnType<typeof vi.fn>>;
  answerResearcherAgent?: { run: ReturnType<typeof vi.fn> };
  humanAnswersArtifact?: Artifact | null;
} = {}) {
  const plan = overrides.plan ?? makePlan({ openQuestions: [] });
  let currentRun: Run = makeRun({ state: RunState.Todo });

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      currentRun = { ...currentRun, ...params };
      return Promise.resolve(currentRun);
    }),
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
      if (type === "HumanAnswers") {
        return Promise.resolve(
          overrides.humanAnswersArtifact === undefined ? null : overrides.humanAnswersArtifact,
        );
      }
      if (type === "Plan") {
        return Promise.resolve(makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
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
      branchName: "ai/lin-1-test-issue",
      labels: [],
      priority: 0,
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
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn().mockResolvedValue(plan) };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] } as PlanReview) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

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
      agentSkillRepo: overrides.agentSkillRepo,
      answerResearcherAgent: overrides.answerResearcherAgent,
    },
    eventRepo,
    artifactRepo,
    plannerAgent,
  };
}

describe("OrchestratorService.retrieveSkillsForPlanning (via startRun)", () => {
  it("queries the skill repo and records a SKILL_INJECTION event when relevant skills are found", async () => {
    const skill: SkillDocument = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "auth-pattern",
      description: "How we do auth",
      taskCategory: "auth",
      skillMarkdown: "# Auth",
      utilityScore: 0.7,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([skill]) };
    const { deps, eventRepo } = buildStartRunDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Test issue"),
      expect.any(Number),
    );
    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("does not record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, eventRepo } = buildStartRunDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });
});

describe("OrchestratorService.maybeResearchAndReplan -- prior HumanAnswers injection", () => {
  it("passes existing human answers into the answer researcher call when a HumanAnswers artifact already exists", async () => {
    const planWithQuestions = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
    });
    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "staging" }];
    const humanAnswersArtifact = makeArtifact({
      type: "HumanAnswers",
      payloadJson: { answers: humanAnswers, submittedAt: new Date().toISOString() },
    });
    const researched: ResearchedAnswers = {
      summary: "done",
      answers: [{ questionId: "q1", question: "Which env?", answer: "staging", confidence: "high" }],
      completedAt: new Date().toISOString(),
    };
    const answerResearcherAgent = { run: vi.fn().mockResolvedValue(researched) };
    const { deps } = buildStartRunDeps({
      plan: planWithQuestions,
      answerResearcherAgent,
      humanAnswersArtifact,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ humanAnswers }),
    );
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- missing plan artifact", () => {
  function buildDeps() {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const deps = minimalDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.PlanReview });
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    return deps;
  }

  it("runManualReReview throws when there is no plan artifact", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("runManualPlanRevision throws when there is no plan artifact", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService -- execution report comment with zero files changed", () => {
  it("omits the files-changed section entirely when filesChanged is empty", async () => {
    const run = makeRun({
      state: RunState.Implementing,
      branchName: "ai/run-1",
      approvedPlanVersion: 1,
      workingDirectory: "/tmp/worktree",
    });
    const plan = makePlan({ planVersion: 1 });
    const report: ExecutionReport = {
      executionVersion: 1,
      summary: "No files needed changing",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 1,
      scoreRationale: "Nothing to do",
    };

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
    const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: plan });
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(planArtifact);
        return Promise.resolve(null);
      }),
    };
    const linearClient = {
      getIssue: vi.fn().mockResolvedValue({
        id: "LIN-1",
        title: "Test",
        description: "Test",
        branchName: "ai/run-1",
        labels: [],
        priority: 0,
      }),
      postComment: vi.fn().mockResolvedValue(undefined),
    };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo: { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) },
      linearClient,
      githubClient: { getPRDiff: vi.fn() },
      gitService: {
        setupRunWorktree: vi.fn(),
        assertBranch: vi.fn(),
        commitAndPush: vi.fn(),
        removeWorktree: vi.fn(),
        resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
      },
      repoRegistry: {
        resolveForIssue: vi.fn(),
        resolveWorkingDirectory: vi.fn(),
        validateWorkingDirectory: vi.fn(),
        getRepoByName: vi.fn().mockReturnValue({
          name: "test-repo",
          defaultBranch: "main",
          allowedPaths: ["src/"],
          protectedPaths: [],
          constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
        }),
        getDefaultRepo: vi.fn(),
      },
      linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      githubSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      plannerAgent: { run: vi.fn() },
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn().mockResolvedValue({ report, prNumber: 900 }) },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("Files changed");
  });
});

describe("OrchestratorService.updateSkillMetrics -- failure path", () => {
  it("calls incrementFailure for injected skills when clarification exhaustion fails the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    let currentRun: Run = { ...run };

    const requiredQuestion = { id: "q1", question: "Which region?", requiredForExecution: true };
    const initialPlan = makePlan({ planVersion: 1, openQuestions: [requiredQuestion] });
    const stillBlockedPlan = makePlan({ planVersion: 2, openQuestions: [requiredQuestion] });
    const taskBundlePayload = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
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
    };

    const injectionEvent: RunEventRecord = {
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-9"] },
      createdAt: new Date(),
    };
    const priorClarificationEvents: RunEventRecord[] = Array.from({ length: 3 }, (_, i) => ({
      id: `evt-c${i}`,
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    }));

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
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: initialPlan }));
        if (type === "TaskBundle") {
          return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundlePayload }));
        }
        return Promise.resolve(null);
      }),
    };
    const eventRepo = {
      create: vi.fn().mockResolvedValue({}),
      findByRunId: vi.fn().mockResolvedValue([injectionEvent, ...priorClarificationEvents]),
    };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({
        id: "skill-9",
        successCount: 0,
        failureCount: 2,
        utilityScore: 0.1,
      }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const deps = {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient: { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) },
      githubClient: { getPRDiff: vi.fn() },
      gitService: {
        setupRunWorktree: vi.fn(),
        assertBranch: vi.fn(),
        commitAndPush: vi.fn(),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
        resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
      },
      repoRegistry: {
        resolveForIssue: vi.fn(),
        resolveWorkingDirectory: vi.fn(),
        validateWorkingDirectory: vi.fn(),
        getRepoByName: vi.fn(),
        getDefaultRepo: vi.fn(),
      },
      linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      githubSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      plannerAgent: { run: vi.fn().mockResolvedValue(stillBlockedPlan) },
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      agentSkillRepo,
    };
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-9");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});
