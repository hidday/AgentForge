import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    state: RunState.Planning,
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
      workingBranch: "ai/run-1",
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
}

function buildDeps(store: TestStore, initialRun: Run) {
  const run: Run = { ...initialRun, state: store.runState };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      run.state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(run, patch);
      return Promise.resolve({ ...run, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
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
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  // The real PlannerAgent persists its own "Plan" artifact as a side effect
  // of run(). `setPlannerPlan` below lets tests configure the plan returned
  // while keeping that persistence consistent with production behaviour.
  const plannerAgent = { run: vi.fn() };
  function setPlannerPlan(plan: Plan): void {
    plannerAgent.run.mockImplementation(async () => {
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    });
  }
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      distillationAgent,
      logger,
      dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    setPlannerPlan,
    planReviewerAgent,
    planReviserAgent,
    gitService,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans and proceeds straight to plan review when there are no blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification again when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("injects prior rejection feedback, human answers, researched answers, and plan review findings when present", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "please redo", source: "api", mode: "iterate" },
        }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }], submittedAt: "2026-01-01T00:00:00Z" },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "research",
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 1, feedback: "please redo" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] },
      }),
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, gitService, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("sets up a fresh worktree when the run has no branchName", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const { deps, gitService, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
  });

  it("transitions through RUN_REQUESTED, re-plans, and ends up pausing for clarification when blocking questions remain", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const { deps, plannerAgent, setPlannerPlan } = buildDeps(store, initialRun);
    setPlannerPlan(
      makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("invokes the plan reviser, records PLAN_REVISED, and posts combined summary + dispositions comment", async () => {
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { reviewId: "pr-1", summary: "needs work", findings: [], overallVerdict: "changes_requested" },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, planReviserAgent, linearClient } = buildDeps(store, initialRun);
    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan,
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments.some((c) => c.includes("Plan Revision Dispositions"))).toBe(true);
    expect(comments.some((c) => c.includes("Revised after AI review"))).toBe(true);
  });

  it("forwards opts.note as an operatorNote to the plan reviser", async () => {
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { reviewId: "pr-1", summary: "needs work", findings: [], overallVerdict: "changes_requested" },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, planReviserAgent } = buildDeps(store, initialRun);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "please hurry" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please hurry" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, runRepo, linearClient } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(result.state).toBe(RunState.Implementing);
    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments[0]).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, linearClient } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "go ahead" });

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments[0]).toContain("approved with operator note");
    expect(comments[0]).toContain("go ahead");
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "bug", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("forwards opts.note to the reviewer as an operatorNote and records it on the event payload", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, eventRepo } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runManualReReview("run-1", { note: "check the auth flow" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "check the auth flow" },
    );
    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((reReviewEvent?.[0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      note: "check the auth flow",
      trigger: "re-review",
    });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("skips revision and stays at AwaitingPlanApproval when the reviewer approves", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("chains into runPlanRevision when the reviewer requests changes", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "bug", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent (best-effort), transitions to Done, and posts a completion comment", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    // A workingDirectory distinct from the gitService's mocked main-repo path
    // (which resolves to "/tmp") so the Done-state worktree cleanup branch
    // (cleanupRunWorktree) actually calls removeWorktree.
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-run-1" });
    const { deps, distillationAgent, linearClient, gitService } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments.some((c) => c.includes("Human review approved"))).toBe(true);
    // Done is a terminal state, so the worktree cleanup path should have run.
    expect(gitService.removeWorktree).toHaveBeenCalled();
  });

  it("swallows a distillation agent failure and still completes the run", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, distillationAgent, logger } = buildDeps(store, initialRun);
    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("completes normally when no distillationAgent was configured", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildDeps(store, initialRun);
    const depsWithoutDistillation = { ...deps, distillationAgent: undefined };

    const svc = new OrchestratorService(depsWithoutDistillation as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
