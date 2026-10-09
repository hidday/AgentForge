import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

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
    state: RunState.Implementing,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
  createdAt?: Date;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

function asEvent(
  eventType: string,
  overrides: Partial<RunEventRecord> = {},
): RunEventRecord {
  return {
    id: overrides.id ?? `event-${Math.random()}`,
    runId: "run-1",
    eventType,
    source: overrides.source ?? "orchestrator",
    payloadJson: overrides.payloadJson ?? {},
    createdAt: overrides.createdAt ?? new Date(),
  };
}

const defaultIssue = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "Test description",
  url: "https://linear.app/x",
  branchName: "ai/lin-1",
  labels: [] as string[],
  priority: 0,
};

const defaultRepoEntry = {
  name: "test-repo",
  defaultBranch: "main",
  allowedPaths: ["src/"],
  protectedPaths: [] as string[],
  constraints: {
    requiredChecks: [] as string[],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [] as string[],
    mustNotTouch: [] as string[],
  },
};

function buildDeps(
  initialRun: Run,
  artifacts: Artifact[] = [],
  events: RunEventRecord[] = [],
  depOverrides: Record<string, unknown> = {},
) {
  let trackedState = initialRun.state;
  let trackedPrNumber = initialRun.prNumber;

  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: trackedState, prNumber: trackedPrNumber }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      trackedState = newState;
      return Promise.resolve({ ...initialRun, state: trackedState, prNumber: trackedPrNumber });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      if (patch.prNumber !== undefined) trackedPrNumber = patch.prNumber;
      return Promise.resolve({
        ...initialRun,
        ...patch,
        state: trackedState,
        prNumber: trackedPrNumber,
      });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      const a = asArtifact({
        type: params.type as string,
        version: params.version as number,
        payloadJson: params.payloadJson,
      });
      artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      const e = asEvent(params.eventType as string, {
        source: params.source as string,
        payloadJson: params.payloadJson,
      });
      events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(defaultIssue),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
      ...depOverrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    distillationAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("happy path with an existing branch: checkpoints via git, runs the executor, persists the PR number, and proceeds to review", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const plan = makePlan();
    const artifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: plan })];
    const built = buildDeps(run, artifacts, []);
    const svc = new OrchestratorService(built.deps as never);

    const report = makeExecutionReport();
    built.executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution(run.id);

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(built.runRepo.update).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ prNumber: 101, executorRuntime: "claude-code" }),
    );
    expect(result.state).toBe(RunState.AIReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Execution Report"),
    );
  });

  it("happy path without a branchName: skips the git checkpoint entirely", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: null });
    const plan = makePlan();
    const artifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: plan })];
    const built = buildDeps(run, artifacts, []);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 55 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution(run.id);

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("throws assertExecutorPaths policy violation when the executor touches a protected path", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const plan = makePlan();
    const built = buildDeps(
      run,
      [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      [],
    );
    (built.deps.repoRegistry as { getRepoByName: ReturnType<typeof vi.fn> }).getRepoByName.mockReturnValue(
      { ...defaultRepoEntry, protectedPaths: ["src/secret/"] },
    );
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["src/secret/key.ts"] }),
      prNumber: 7,
    });

    await expect(svc.runExecution(run.id)).rejects.toMatchObject({
      rule: "executor_touched_protected_path",
    });
  });

  it("idempotent recovery: when an ExecutionReport already exists past the last EXECUTION_STARTED with no later EXECUTION_FINISHED, skips the executor and jumps to review", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 99 });
    const plan = makePlan();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportAt = new Date("2026-01-01T00:05:00Z");
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: reportAt,
      }),
    ];
    const events = [asEvent(RunEvent.EXECUTION_STARTED, { createdAt: startedAt })];
    const built = buildDeps(run, artifacts, events);
    const svc = new OrchestratorService(built.deps as never);

    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution(run.id);

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, prNumber: 99 }),
      expect.stringContaining("Recovered stranded execution"),
    );
    const recoveredEvent = events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect(recoveredEvent?.payloadJson).toMatchObject({ recovered: true });
    expect(result.state).toBe(RunState.AIReview);
  });

  it("does NOT trigger idempotent recovery when EXECUTION_FINISHED already fired after the report (falls through to normal execution)", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 99 });
    const plan = makePlan();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportAt = new Date("2026-01-01T00:05:00Z");
    const finishedAt = new Date("2026-01-01T00:06:00Z");
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: reportAt,
      }),
    ];
    const events = [
      asEvent(RunEvent.EXECUTION_STARTED, { createdAt: startedAt }),
      asEvent(RunEvent.EXECUTION_FINISHED, { createdAt: finishedAt }),
    ];
    const built = buildDeps(run, artifacts, events);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ executionVersion: 2 }),
      prNumber: 99,
    });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution(run.id);

    // Falls through to the normal path: the executor IS invoked.
    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("AgentTimeoutError from the executor: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without re-throwing", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const plan = makePlan();
    const built = buildDeps(
      run,
      [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      [],
    );
    const svc = new OrchestratorService(built.deps as never);

    const timeoutErr = new AgentTimeoutError("executor", 600_000);
    built.executorAgent.run.mockRejectedValue(timeoutErr);

    const result = await svc.runExecution(run.id);

    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        eventType: "EXECUTION_TIMEOUT",
        payloadJson: { agent: "executor", timeoutMs: 600_000 },
      }),
    );
    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("timed out"),
    );
  });

  it("re-throws non-AgentTimeoutError failures from the executor", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const plan = makePlan();
    const built = buildDeps(
      run,
      [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      [],
    );
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution(run.id)).rejects.toThrow("boom");
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict: transitions to ReadyForHumanReview via markReady, with no GitHub findings sync when there are no findings", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const built = buildDeps(run, [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
    ]);
    const svc = new OrchestratorService(built.deps as never);

    const approvedReview = makeReview({ overallVerdict: "approved" });
    built.reviewerAgent.run.mockImplementation(async (_plan, _report, _diff, _bundle, runId: string) => {
      // Mirror the real ReviewerAgent, which persists its own Review artifact;
      // markReady (invoked at the end of this flow) reads it back.
      await built.artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: approvedReview,
        rawText: "",
      });
      return approvedReview;
    });

    const result = await svc.runReview(run.id);

    expect(
      (built.deps.githubSync as { postReviewFindings: ReturnType<typeof vi.fn> })
        .postReviewFindings,
    ).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("changes_requested verdict with a PR and findings: posts findings to GitHub and delegates to runRemediation", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/a.ts",
          title: "Bug",
          details: "details",
        },
      ],
    });
    const built = buildDeps(run, [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
    ]);
    const svc = new OrchestratorService(built.deps as never);

    built.reviewerAgent.run.mockResolvedValue(review);
    const postReviewFindings = (
      built.deps.githubSync as { postReviewFindings: ReturnType<typeof vi.fn> }
    ).postReviewFindings;
    postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const result = await svc.runReview(run.id);

    expect(postReviewFindings).toHaveBeenCalledWith(
      run.repo,
      run.prNumber,
      review.findings,
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith(run.id, { f1: 123 });
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  // Note: runReview's `run.prNumber ? getPRDiff(...) : ""` ternary has a
  // false-branch that is unreachable in practice: policy.assertCanReview()
  // (called earlier in the same method) already throws "Cannot review
  // without an existing PR" whenever prNumber is falsy, so runReview can
  // never reach the diff line with a null/0 prNumber. Not forcing that
  // branch; it is dead code given the policy guard ordering.
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when all policy checks pass", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const review = makeReview({ overallVerdict: "approved" });
    const report = makeExecutionReport();
    const built = buildDeps(run, [
      asArtifact({ type: "Review", version: 1, payloadJson: review }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
    ]);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady(run.id);

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe(run.id);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation then transitions to Done and posts the completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(run, [], [], {
      distillationAgent: { run: vi.fn().mockResolvedValue(undefined) },
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview(run.id);

    expect(
      (built.deps.distillationAgent as { run: ReturnType<typeof vi.fn> }).run,
    ).toHaveBeenCalledWith(run.id, expect.objectContaining({ id: run.id }));
    expect(result.state).toBe(RunState.Done);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Done"),
    );
    // Done is a terminal state, so worktree cleanup runs.
    expect(built.gitService.removeWorktree).toHaveBeenCalled();
  });

  it("swallows a distillation failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(run, [], [], {
      distillationAgent: { run: vi.fn().mockRejectedValue(new Error("distillation exploded")) },
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview(run.id);

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, error: "distillation exploded" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("works fine with no distillationAgent dependency configured at all", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(run, [], [], { distillationAgent: undefined });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview(run.id);

    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService -- skill retrieval and metrics (private helpers exercised via public flows)", () => {
  it("retrieveSkillsForPlanning returns [] and never calls the repo when agentSkillRepo is not configured", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(run, [], [], { agentSkillRepo: undefined });
    const svc = new OrchestratorService(built.deps as never);
    built.deps.runRepo = built.runRepo as never;

    // retryRun calls retrieveSkillsForPlanning internally; verify no crash and
    // plannerAgent receives priorSkills: [].
    const plan = makePlan({ openQuestions: [] });
    (built.deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mockImplementation(
      async (_bundle: unknown, runId: string) => {
        await built.artifactRepo.create({
          runId,
          type: "Plan",
          version: plan.planVersion,
          payloadJson: plan,
          rawText: "",
        });
        return plan;
      },
    );
    (built.deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    const plannerCallOpts = (built.deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mock
      .calls[0]?.[2] as { priorSkills: unknown[] };
    expect(plannerCallOpts.priorSkills).toEqual([]);
  });

  it("retrieveSkillsForPlanning injects top-K skills and records a SKILL_INJECTION event when skills are found", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, linearIssueTitle: "Fix bug" });
    const findTopKByRelevance = vi
      .fn()
      .mockResolvedValue([{ id: "skill-1", taskCategory: "bugfix", snippet: "do X" }]);
    const built = buildDeps(run, [], [], {
      agentSkillRepo: { findTopKByRelevance },
    });
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ openQuestions: [] });
    (built.deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mockImplementation(
      async (_bundle: unknown, runId: string) => {
        await built.artifactRepo.create({
          runId,
          type: "Plan",
          version: plan.planVersion,
          payloadJson: plan,
          rawText: "",
        });
        return plan;
      },
    );
    (built.deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.stringContaining("Fix bug"), expect.any(Number));
    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, eventType: "SKILL_INJECTION" }),
    );
  });

  it("updateSkillMetrics is a no-op when agentSkillRepo is not configured (never reads events)", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(run, [], [], { agentSkillRepo: undefined });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview(run.id);

    expect(result.state).toBe(RunState.Done);
    // Guarded by `if (!this.agentSkillRepo) return;` before touching eventRepo.
    expect(built.eventRepo.findByRunId).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics is a no-op when agentSkillRepo is configured but no SKILL_INJECTION events were recorded", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const incrementSuccess = vi.fn();
    const built = buildDeps(run, [], [asEvent(RunEvent.HUMAN_APPROVED)], {
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility: vi.fn() },
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview(run.id);

    expect(incrementSuccess).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics increments success for all skills injected across multiple SKILL_INJECTION events, deduplicated, and archives low-utility ones", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const events = [
      asEvent("SKILL_INJECTION", { payloadJson: { skillIds: ["s1", "s2"] } }),
      asEvent("SKILL_INJECTION", { payloadJson: { skillIds: ["s2", "s3"] } }),
    ];
    const incrementSuccess = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, utilityScore: 0.5 }),
    );
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const built = buildDeps(run, [], events, {
      agentSkillRepo: { incrementSuccess, archiveIfLowUtility, incrementFailure: vi.fn() },
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview(run.id);

    expect(incrementSuccess).toHaveBeenCalledTimes(3);
    expect(incrementSuccess.mock.calls.map((c) => c[0]).sort()).toEqual(["s1", "s2", "s3"]);
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(3);
  });

  it("updateSkillMetrics calls incrementFailure (not incrementSuccess) when the run transitions to Failed, and logs+continues when a per-skill update throws", async () => {
    // Drive a real Failed transition via answerQuestions' clarification-exhaustion
    // path: 3 prior NEEDS_HUMAN_CLARIFICATION events already recorded, and the
    // re-plan still has a blocking question, so CLARIFICATION_EXHAUSTED fires.
    const run = makeRun({
      state: RunState.HumanClarificationNeeded,
      branchName: null,
      planVersion: 1,
    });
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: defaultIssue,
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp/worktree",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
      constraints: defaultRepoEntry.constraints,
      definitionOfDone: [],
    };
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
    ];
    const events = [
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent("SKILL_INJECTION", { payloadJson: { skillIds: ["s1", "s2"] } }),
    ];
    const incrementFailure = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ id: "s2", utilityScore: 0.1 });
    const incrementSuccess = vi.fn();
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const built = buildDeps(run, artifacts, events, {
      agentSkillRepo: { incrementFailure, incrementSuccess, archiveIfLowUtility },
    });
    const svc = new OrchestratorService(built.deps as never);

    // Re-plan still returns a blocking question, so clarification is exhausted.
    const stillBlockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
    });
    (built.deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(
      stillBlockingPlan,
    );

    const result = await svc.answerQuestions(run.id, [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(incrementSuccess).not.toHaveBeenCalled();
    expect(incrementFailure).toHaveBeenCalledTimes(2);
    expect(incrementFailure.mock.calls.map((c) => c[0]).sort()).toEqual(["s1", "s2"]);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, skillId: "s1", error: "db down" }),
      "Failed to update skill metric",
    );
    // Only the successfully-updated skill gets archive-checked.
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
