import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    prNumber: 5,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
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
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, agentSkillRepoOverrides?: Record<string, unknown>) {
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

  let eventSeq = 0;
  const eventRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
          eventSeq += 1;
          const rec: RunEventRecord = {
            id: `event-${eventSeq}`,
            runId: params.runId,
            eventType: params.eventType,
            source: params.source,
            payloadJson: params.payloadJson,
            createdAt: new Date(),
          };
          store.events.push(rec);
          return Promise.resolve(rec);
        },
      ),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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

  const agentSkillRepo = agentSkillRepoOverrides
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([]),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
        ...agentSkillRepoOverrides,
      }
    : undefined;

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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    distillationAgent,
    gitService,
    logger,
    planReviserAgent,
    planReviewerAgent,
    agentSkillRepo,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, posts the completion comment, and cleans up the worktree", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, distillationAgent, linearClient, gitService } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
    // workingDirectory ("/tmp/worktree") differs from resolveMainRepoPath ("/tmp/main-repo")
    // -> worktree cleanup runs.
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("skips worktree cleanup when the working directory IS the main repo path", async () => {
    const store: TestStore = { run: makeRun({ workingDirectory: "/tmp/main-repo" }), artifacts: [], events: [] };
    const { deps, gitService } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("swallows a distillation failure (best-effort) and still completes the run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, distillationAgent, logger } = buildDeps(store);
    distillationAgent.run.mockRejectedValue(new Error("distillation boom"));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("updates skill metrics on success for every distinct injected skill id", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a", "skill-b"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] }, // duplicate -- must be deduped
          createdAt: new Date(),
        },
      ],
    };
    const incrementSuccess = vi.fn().mockImplementation((id: string) => Promise.resolve({ id }));
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const { deps } = buildDeps(store, { incrementSuccess, archiveIfLowUtility });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).toHaveBeenCalledTimes(2);
    expect(incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when updating one skill's metrics throws", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-bad", "skill-good"] },
          createdAt: new Date(),
        },
      ],
    };
    const incrementSuccess = vi.fn().mockImplementation((id: string) => {
      if (id === "skill-bad") return Promise.reject(new Error("db down"));
      return Promise.resolve({ id });
    });
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const { deps, logger } = buildDeps(store, { incrementSuccess, archiveIfLowUtility });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-bad", error: "db down" }),
      "Failed to update skill metric",
    );
    // The failure for skill-bad must not prevent skill-good from being processed.
    expect(incrementSuccess).toHaveBeenCalledWith("skill-good");
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval on an approved re-review verdict", async () => {
    const plan = makePlan();
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Still good",
      findings: [],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1", { note: "double-checking" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const reReviewEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect(reReviewEvent).toBeDefined();
    expect((reReviewEvent![0] as { payloadJson: { note: string } }).payloadJson.note).toBe(
      "double-checking",
    );
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double-checking" },
    );
  });

  it("also returns to AwaitingPlanApproval (not PlanRevision) when changes are requested", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "d" }],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    // Per the documented "always return to AwaitingPlanApproval" behaviour.
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays at AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store);
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

  it("chains into runPlanRevision (with operator note) when changes are requested", async () => {
    const plan = makePlan();
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs revision",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed" }] },
      revisedPlan: { ...plan, planVersion: 2 },
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});
