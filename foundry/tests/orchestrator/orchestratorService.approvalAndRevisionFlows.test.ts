import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
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
  runPatch: Partial<Run>;
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.runPatch = { ...store.runPatch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
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
    getRepoByName: vi.fn().mockReturnValue(null),
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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
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
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {} };
    const initialRun = makeRun();
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain comment without a note", async () => {
    const plan = makePlan({ planVersion: 3 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 3, payloadJson: plan })],
      runPatch: { planVersion: 3 },
    };
    const initialRun = makeRun({ planVersion: 3 });
    const { deps, runRepo, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      runPatch: { planVersion: 2 },
    };
    const initialRun = makeRun({ planVersion: 2 });
    const { deps, linearClient, eventRepo } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "Please prioritize security" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Please prioritize security"),
    );
    const transitionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(transitionEvent).toBeDefined();
    expect((transitionEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "Please prioritize security",
    );
  });
});

describe("OrchestratorService.runPlanReview -- changes_requested path", () => {
  it("transitions to PlanRevision, posts the plan-review comment, then revises the plan", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: { planVersion: 1 },
    };
    const initialRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const { deps, planReviewerAgent, planReviserAgent, linearClient } = buildDeps(store, initialRun);

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "gap",
          title: "Missing tests",
          details: "No test plan for step 1",
        },
      ],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Added a test step" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // The plan-review "changes requested" comment is posted before revision.
    const reviewComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Changes Requested"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1]).toContain("Missing tests");
    // The revision-disposition comment is posted afterwards.
    const revisionComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(revisionComment).toBeDefined();
    expect(revisionComment![1]).toContain("Added a test step");
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Still good",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs another pass",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "t", details: "d" }],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double-check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double-check auth" },
    );
  });

  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays in AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Fine as-is",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("revises the plan and returns to AwaitingPlanApproval when the reviewer requests changes", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent, linearClient } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "One more pass",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "focus on step 2" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // runPlanRevision (invoked internally) re-fetches the PlanReview artifact rather
    // than reusing the verdict computed above; since no PlanReview artifact was
    // persisted in this test, it is undefined here -- this documents that real
    // control-flow quirk rather than asserting an idealized call shape.
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on step 2" },
    );
    expect(linearClient.postComment).toHaveBeenCalled();
  });

  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    const { deps, distillationAgent, linearClient } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("continues (best-effort) and still marks Done when the distillation agent throws", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, distillationAgent, logger } = buildDeps(store, initialRun);
    distillationAgent.run.mockRejectedValue(new Error("distillation exploded"));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation exploded" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("skips distillation entirely when no distillationAgent dependency was supplied", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildDeps(store, initialRun, { distillationAgent: undefined });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
