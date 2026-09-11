import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.HumanClarificationNeeded,
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

const REPO_ENTRY = {
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
};

// ---------------------------------------------------------------------------
// Stateful harness (duplicated per-file by convention -- see
// orchestratorService.lifecycle.test.ts for the canonical shape).
// ---------------------------------------------------------------------------

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeArtifact(store: Store, type: ArtifactType, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: store.run.id,
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function buildHarness(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: Store = { run: initialRun, artifacts: [...initialArtifacts], events: [] };

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
      .mockImplementation(
        (params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
          const a = makeArtifact(store, params.type as ArtifactType, params.version, params.payloadJson);
          store.artifacts.push(a);
          return Promise.resolve(a);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(REPO_ENTRY),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(REPO_ENTRY),
    getDefaultRepo: vi.fn().mockReturnValue(REPO_ENTRY),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, utilityScore: 1 })),
    incrementFailure: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, utilityScore: 0 })),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };

  const deps = {
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
    agentSkillRepo,
    logger,
    dashboardEmitter,
  };

  return {
    store,
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    answerResearcherAgent,
    agentSkillRepo,
    gitService,
    logger,
  };
}

/** Mirrors the real PlannerAgent: resolves with `plan` and persists it as a Plan artifact. */
function queuePlannerPlan(h: { plannerAgent: { run: ReturnType<typeof vi.fn> }; store: Store }, plan: Plan) {
  h.plannerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "Plan", plan.planVersion, plan));
    return plan;
  });
}

// ---------------------------------------------------------------------------
// updateSkillMetrics (exercised via transitionAndRecord reaching Done/Failed)
// ---------------------------------------------------------------------------

describe("OrchestratorService -- updateSkillMetrics on run failure", () => {
  it("increments failure counters and archives low-utility skills for every injected skill id when the run fails", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const h = buildHarness(initialRun);
    // No answer researcher configured for this scenario -- the re-plan's
    // still-blocking questions should route straight to clarification
    // exhaustion without an intervening research pass.
    const svc = new OrchestratorService({ ...h.deps, answerResearcherAgent: undefined } as never);

    h.store.artifacts.push(
      makeArtifact(
        h.store,
        "Plan",
        1,
        makePlan({ openQuestions: [{ id: "q1", question: "R?", requiredForExecution: true }] }),
      ),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "TaskBundle", 1, {
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
      }),
    );
    h.store.events.push({
      id: "e-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a"] },
      createdAt: new Date(),
    });
    // 3 prior clarification rounds -> next one hits MAX_CLARIFICATION_ITERATIONS.
    for (let i = 0; i < 3; i++) {
      h.store.events.push({
        id: `prior-${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      });
    }

    queuePlannerPlan(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "no idea" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-a");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-a", utilityScore: 0 });
  });

  it("logs a warning and continues with the remaining skill ids when updating one skill's metrics throws", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService({ ...h.deps, answerResearcherAgent: undefined } as never);

    h.store.artifacts.push(
      makeArtifact(
        h.store,
        "Plan",
        1,
        makePlan({ openQuestions: [{ id: "q1", question: "R?", requiredForExecution: true }] }),
      ),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "TaskBundle", 1, {
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
      }),
    );
    // Two distinct skill ids injected across (possibly repeated) events; the
    // Set-based de-dup must still process both exactly once.
    h.store.events.push({
      id: "e-skill-1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-fails", "skill-ok"] },
      createdAt: new Date(),
    });
    h.store.events.push({
      id: "e-skill-2",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-ok"] },
      createdAt: new Date(),
    });
    for (let i = 0; i < 3; i++) {
      h.store.events.push({
        id: `prior-${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      });
    }

    h.agentSkillRepo.incrementFailure.mockImplementation((id: string) => {
      if (id === "skill-fails") return Promise.reject(new Error("db unavailable"));
      return Promise.resolve({ id, utilityScore: 0 });
    });

    queuePlannerPlan(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "no idea" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-fails");
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-ok");
    // The failing id must not prevent archiveIfLowUtility from being called for the healthy one.
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-ok", utilityScore: 0 });

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { skillId: string; error: string }).skillId).toBe("skill-fails");
    expect((warnCall![0] as { skillId: string; error: string }).error).toBe("db unavailable");
  });
});

// ---------------------------------------------------------------------------
// maybeResearchAndReplan: humanAnswers threaded into the researcher call
// ---------------------------------------------------------------------------

describe("OrchestratorService -- maybeResearchAndReplan with existing HumanAnswers", () => {
  it("forwards prior HumanAnswers into both the researcher call and the post-research re-plan call", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    h.store.artifacts.push(
      makeArtifact(h.store, "HumanAnswers", 1, {
        answers: [{ questionId: "q0", answer: "already answered" }],
      }),
    );

    const planWithQuestions = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    queuePlannerPlan(h, planWithQuestions);

    h.answerResearcherAgent.run.mockResolvedValue({
      summary: "resolved",
      answers: [{ questionId: "q1", question: "Optional?", answer: "yes", confidence: "high" }],
      completedAt: "2026-01-01T00:00:00Z",
    });

    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });
    queuePlannerPlan(h, revisedPlan);

    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runPlanning("run-1");

    expect(h.answerResearcherAgent.run).toHaveBeenCalledWith(
      planWithQuestions,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q0", answer: "already answered" }],
      }),
    );

    // Second plannerAgent.run call (post-research) also carries humanAnswers.
    expect(h.plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(h.plannerAgent.run.mock.calls[1]?.[2]).toMatchObject({
      humanAnswers: [{ questionId: "q0", answer: "already answered" }],
    });
  });
});

// ---------------------------------------------------------------------------
// rejectPlan (iterate mode): prior humanAnswers/researchedAnswers/planReview
// context loaded via loadReplanContext() and threaded into the re-plan call.
// ---------------------------------------------------------------------------

describe("OrchestratorService.rejectPlan -- iterate mode loads full prior context", () => {
  it("threads previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext into the re-plan call", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    const previousPlan = makePlan({ planVersion: 1 });
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, previousPlan));
    h.store.artifacts.push(
      makeArtifact(h.store, "HumanAnswers", 1, {
        answers: [{ questionId: "q1", answer: "yes" }],
      }),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "ResearchedAnswers", 1, {
        summary: "s",
        answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "medium" }],
        completedAt: "2026-01-01T00:00:00Z",
      }),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "PlanReview", 1, {
        summary: "please tighten scope",
        findings: [{ id: "f1", severity: "nit", title: "T", details: "D" }],
      }),
    );

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-2",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.rejectPlan("run-1", "please redo step 2", "api", "iterate");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          expect.objectContaining({ questionId: "q1", confidence: "medium" }),
        ],
        planReviewFindings: expect.objectContaining({ summary: "please tighten scope" }),
      }),
    );
  });
});
