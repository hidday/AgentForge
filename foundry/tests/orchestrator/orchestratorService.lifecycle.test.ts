import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

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

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
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
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
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
// Stateful harness: mirrors production semantics closely enough (run state,
// artifact versioning, event log) that flows spanning multiple internal
// transitions can be driven end-to-end without hand-chaining
// mockResolvedValueOnce() calls per call site.
// ---------------------------------------------------------------------------

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/**
 * Queues a single plannerAgent.run() resolution AND -- mirroring what the
 * real PlannerAgent does in production -- persists the resulting Plan as an
 * artifact in the store, so that a subsequent runPlanReview()/answerQuestions()
 * call within the same flow can find it via findLatestByType("Plan").
 */
function queuePlannerPlan(h: { plannerAgent: { run: ReturnType<typeof vi.fn> }; store: Store }, plan: Plan) {
  h.plannerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "Plan", plan.planVersion, plan));
    return plan;
  });
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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    incrementSuccess: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, utilityScore: 1 }),
    ),
    incrementFailure: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, utilityScore: 0 }),
    ),
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
    distillationAgent,
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
    githubClient,
    repoRegistry,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    distillationAgent,
    gitService,
    agentSkillRepo,
    logger,
  };
}

// ---------------------------------------------------------------------------
// runPlanning
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanning", () => {
  it("injects prior plan/rejection/human/research/review context into the planner and proceeds to plan review when unblocked", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    const previousPlan = makePlan({ planVersion: 1 });
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, previousPlan));
    h.store.artifacts.push(
      makeArtifact(h.store, "RejectionContext", 1, {
        planVersion: 1,
        feedback: "Do it differently",
        source: "api",
        mode: "iterate",
      }),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "HumanAnswers", 1, {
        answers: [{ questionId: "q1", answer: "yes" }],
      }),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "ResearchedAnswers", 1, {
        summary: "s",
        answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
        completedAt: "2026-01-01T00:00:00Z",
      }),
    );
    h.store.artifacts.push(
      makeArtifact(h.store, "PlanReview", 1, {
        summary: "changes needed",
        findings: [{ id: "f1", severity: "important", title: "T", details: "D" }],
      }),
    );

    const nextPlan = makePlan({ planVersion: 2, openQuestions: [] });
    queuePlannerPlan(h, nextPlan);
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const result = await svc.runPlanning("run-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Do it differently" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          expect.objectContaining({ questionId: "q1", confidence: "high" }),
        ],
        planReviewFindings: expect.objectContaining({ summary: "changes needed" }),
      }),
    );

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviewerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    const blockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "What now?", requiredForExecution: true }],
    });
    queuePlannerPlan(h, blockedPlan);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});

// ---------------------------------------------------------------------------
// retryRun
// ---------------------------------------------------------------------------

describe("OrchestratorService.retryRun", () => {
  it("skips worktree setup when the run already has a branch, then re-plans and proceeds to plan review", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const result = await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("sets up a fresh worktree when the run has no branch yet", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(h.store.run.workingDirectory).toBe("/tmp/worktree");
    expect(h.store.run.branchName).toBe("ai/run-1");
  });

  it("pauses for human clarification when the retried plan has blocking questions", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    queuePlannerPlan(h, 
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("uses agentSkillRepo to retrieve prior skills and records a SKILL_INJECTION event when skills are found", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Do the thing",
        description: "desc",
        taskCategory: "cat",
        skillMarkdown: "# md",
        utilityScore: 1,
        lastUsedAt: new Date(),
      },
    ]);
    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    await svc.retryRun("run-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.any(String), 3);
    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("SKILL_INJECTION");
  });
});

// ---------------------------------------------------------------------------
// runPlanReview (changes_requested cascade) + runPlanRevision
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanReview -- changes requested cascade", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("posts a changes-requested comment and cascades into runPlanRevision, ending back at AwaitingPlanApproval", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    const plan = makePlan({ planVersion: 1 });
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, plan));

    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "risk", title: "Risky", details: "explain" },
        ],
      }),
    );

    const revisedPlan = makePlan({ planVersion: 2 });
    h.planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed it" }],
      },
      revisedPlan,
    });

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);

    const comments = h.linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments.some((c) => c.includes("Changes Requested"))).toBe(true);
    expect(comments.some((c) => c.includes("Plan Revision Dispositions"))).toBe(true);
    expect(h.store.run.planVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// approvePlan
// ---------------------------------------------------------------------------

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 2, makePlan({ planVersion: 2 })));

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(h.store.run.approvedPlanVersion).toBe(2);
    const comment = h.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("Plan v2 approved. Starting implementation");
    expect(comment).not.toContain("operator note");
  });

  it("includes the operator note in the approval comment and event payload when supplied", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    await svc.approvePlan("run-1", { note: "Please prioritize security" });

    const comment = h.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("Please prioritize security");

    const approvalEvent = h.store.events.find((e) => e.eventType === RunEvent.PLAN_APPROVED);
    expect((approvalEvent?.payloadJson as { note?: string })?.note).toBe(
      "Please prioritize security",
    );
  });
});

// ---------------------------------------------------------------------------
// runManualReReview
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1", { note: "double-check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.anything(),
      "run-1",
      { operatorNote: "double-check auth" },
    );
    const reReviewEvent = h.store.events.find((e) => e.eventType === RunEvent.RE_REVIEW_REQUESTED);
    expect((reReviewEvent?.payloadJson as { note?: string })?.note).toBe("double-check auth");
  });

  it("also returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "nit", type: "style", title: "T", details: "D" }],
      }),
    );

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // Human retains control -- runPlanRevision must NOT have been invoked.
    expect(h.deps.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

// ---------------------------------------------------------------------------
// runManualPlanRevision
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays at AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("revises the plan and ends at AwaitingPlanApproval when the reviewer requests changes", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "T", details: "D" }],
      }),
    );
    h.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "please tighten scope" });

    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.store.run.planVersion).toBe(2);
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

// ---------------------------------------------------------------------------
// approveHumanReview (+ cleanupRunWorktree + updateSkillMetrics via Done)
// ---------------------------------------------------------------------------

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, removes the worktree, and updates skill metrics for injected skills", async () => {
    const initialRun = makeRun({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/worktree",
    });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp"); // differs from workingDirectory

    h.store.events.push({
      id: "e-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
      createdAt: new Date(),
    });

    const result = await svc.approveHumanReview("run-1");

    expect(h.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(h.gitService.removeWorktree).toHaveBeenCalledWith("/tmp", "/tmp/worktree");
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);

    const comment = h.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("Done");
  });

  it("continues to HUMAN_APPROVED even when the distillation agent throws (best-effort)", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
  });

  it("does not fail when no distillation agent is configured", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const h = buildHarness(initialRun);
    const depsWithoutDistillation = { ...h.deps, distillationAgent: undefined };
    const svc = new OrchestratorService(depsWithoutDistillation as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does not attempt worktree cleanup when the run's working directory already IS the main repo path", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp"); // equal -> early return

    await svc.approveHumanReview("run-1");

    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rejectPlan -- fresh mode + blocking-after-rejection
// ---------------------------------------------------------------------------

describe("OrchestratorService.rejectPlan -- additional branches", () => {
  it("fresh mode does not load prior plan/answers context for the re-plan", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    await svc.rejectPlan("run-1", "start over please", "api", "fresh");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
    const comment = h.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("Plan rejected (fresh)");
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    queuePlannerPlan(h, 
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const result = await svc.rejectPlan("run-1", "unclear direction", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// answerQuestions -- additional branches not covered by the clarification suite
// ---------------------------------------------------------------------------

describe("OrchestratorService.answerQuestions -- additional branches", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(
      makeArtifact(
        h.store,
        "Plan",
        1,
        makePlan({ openQuestions: [{ id: "q1", question: "R?", requiredForExecution: true }] }),
      ),
    );

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("re-transitions to HumanClarificationNeeded with an incremented iteration count when blockers remain and the max has not been reached", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(
      makeArtifact(
        h.store,
        "Plan",
        1,
        makePlan({ openQuestions: [{ id: "q1", question: "R?", requiredForExecution: true }] }),
      ),
    );
    h.store.artifacts.push(makeArtifact(h.store, "TaskBundle", 1, makeTaskBundle()));
    // One prior clarification round (< MAX_CLARIFICATION_ITERATIONS = 3).
    h.store.events.push({
      id: "prior-1",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });

    queuePlannerPlan(h, 
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "maybe" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastClarification = [...h.store.events]
      .reverse()
      .find((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect((lastClarification?.payloadJson as { iteration?: number })?.iteration).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildTaskBundle: remote default branch differs from config
// ---------------------------------------------------------------------------

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("prefers the remote default branch and logs a warning when it differs from the configured value", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.githubClient.getDefaultBranch.mockResolvedValue("develop");

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview());

    await svc.runPlanning("run-1");

    const plannerCallBundle = h.plannerAgent.run.mock.calls[0]?.[0] as TaskBundle;
    expect(plannerCallBundle.repo.defaultBranch).toBe("develop");

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
  });
});
