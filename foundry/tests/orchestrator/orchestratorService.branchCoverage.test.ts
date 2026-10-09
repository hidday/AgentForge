import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, RejectionContextPayload } from "../../src/domain/types.js";
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
}): Artifact {
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

function asEvent(eventType: string, overrides: Partial<RunEventRecord> = {}): RunEventRecord {
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
  let trackedPlanVersion = initialRun.planVersion;
  let trackedApproved = initialRun.approvedPlanVersion;
  let trackedPrNumber = initialRun.prNumber;
  let trackedBranchName = initialRun.branchName;
  let trackedWorkingDirectory = initialRun.workingDirectory;

  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({
        ...initialRun,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
        branchName: trackedBranchName,
        workingDirectory: trackedWorkingDirectory,
      }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      trackedState = newState;
      return Promise.resolve({
        ...initialRun,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
        branchName: trackedBranchName,
        workingDirectory: trackedWorkingDirectory,
      });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      if (patch.planVersion !== undefined) trackedPlanVersion = patch.planVersion;
      if (patch.approvedPlanVersion !== undefined) trackedApproved = patch.approvedPlanVersion;
      if (patch.prNumber !== undefined) trackedPrNumber = patch.prNumber;
      if (patch.branchName !== undefined) trackedBranchName = patch.branchName;
      if (patch.workingDirectory !== undefined) trackedWorkingDirectory = patch.workingDirectory;
      return Promise.resolve({
        ...initialRun,
        ...patch,
        state: trackedState,
        planVersion: trackedPlanVersion,
        approvedPlanVersion: trackedApproved,
        prNumber: trackedPrNumber,
        branchName: trackedBranchName,
        workingDirectory: trackedWorkingDirectory,
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
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService -- requireRun", () => {
  it("throws 'Run not found' when runRepo.findById returns null", async () => {
    const built = buildDeps(makeRun(), []);
    built.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("OrchestratorService.runPlanReview -- missing plan artifact", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.Planning });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview(run.id)).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.retryRun -- repo resolution fallback", () => {
  it("falls back to getDefaultRepo() when getRepoByName() returns undefined", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(run, []);
    (built.deps.repoRegistry as { getRepoByName: ReturnType<typeof vi.fn> }).getRepoByName.mockReturnValue(
      undefined,
    );
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async (_bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(
      (built.deps.repoRegistry as { getDefaultRepo: ReturnType<typeof vi.fn> }).getDefaultRepo,
    ).toHaveBeenCalled();
  });
});

describe("OrchestratorService.runExecution -- operator note and comment formatting branches", () => {
  it("forwards opts.note to the executor as an operatorNote", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", approvedPlanVersion: 1 });
    const plan = makePlan();
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 1 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution(run.id, { note: "focus on perf" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      run.id,
      expect.objectContaining({ existingBranch: "ai/run-1" }),
      { operatorNote: "focus on perf" },
    );
  });

  it("formats a report with a failing and a skipped check, zero files changed, and notes present", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", approvedPlanVersion: 1 });
    const plan = makePlan();
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    const report = makeExecutionReport({
      filesChanged: [],
      notes: ["Heads up: flaky test skipped"],
      checks: {
        lint: { status: "fail", details: "2 errors" },
        typecheck: { status: "skip", details: "not run" },
        tests: { status: "pass", details: "ok" },
      },
    });
    built.executorAgent.run.mockResolvedValue({ report, prNumber: 2 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution(run.id);

    const comment = built.linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain(":x:"); // fail icon
    expect(comment).toContain(":heavy_minus_sign:"); // skip icon
    expect(comment).toContain(":white_check_mark:"); // pass icon
    expect(comment).not.toContain("Files changed");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Heads up: flaky test skipped");
  });

  it("collapses the file list inside <details> when more than 8 files changed", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", approvedPlanVersion: 1 });
    const plan = makePlan();
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });
    built.executorAgent.run.mockResolvedValue({ report, prNumber: 3 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution(run.id);

    const comment = built.linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });
});

describe("OrchestratorService.runRemediation -- full success path reaching markReady", () => {
  it("returns the run after markReady succeeds, when remediation produces an approved Review", async () => {
    const run = makeRun({ state: RunState.AddressingReview, prNumber: 42, planVersion: 1 });
    const execReport = makeExecutionReport({
      executionVersion: 1,
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "fail", details: "regressed" },
      },
      score: 0.5,
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/a.ts",
          title: "Bug",
          details: "details",
        },
      ],
    });
    const artifacts = [
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: execReport }),
      asArtifact({ type: "Review", version: 1, payloadJson: review }),
    ];
    const built = buildDeps(run, artifacts, []);
    const svc = new OrchestratorService(built.deps as never);

    built.remediationAgent.run.mockImplementation(
      async (_review: Review, prevReport: ExecutionReport, _wd: string, runId: string) => {
        const newReport = makeExecutionReport({
          executionVersion: prevReport.executionVersion + 1,
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "all green" },
          },
          score: 0.95,
        });
        await built.artifactRepo.create({
          runId,
          type: "ExecutionReport",
          version: newReport.executionVersion,
          payloadJson: newReport,
          rawText: "",
        });
        // Simulate the review stage re-approving post-remediation so markReady
        // (invoked at the end of runRemediation) can succeed end-to-end. This
        // exercises the markReady success path and runRemediation's own final
        // `return run;` after it.
        const approvedReview = makeReview({ overallVerdict: "approved" });
        await built.artifactRepo.create({
          runId,
          type: "Review",
          version: 2,
          payloadJson: approvedReview,
          rawText: "",
        });
        const remediation: Remediation = {
          reviewId: review.reviewId,
          resolution: [
            { findingId: "f1", status: "accepted", action: "fixed", rationale: "real bug" },
          ],
          readyForHumanReview: true,
          executionReport: newReport,
        };
        return remediation;
      },
    );

    const result = await svc.runRemediation(run.id);

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
  });
});

describe("OrchestratorService.answerQuestions -- missing artifacts and iteration branches", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions(run.id, [{ questionId: "q1", answer: "x" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when no TaskBundle artifact exists (after already transitioning to Planning)", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions(run.id, [{ questionId: "q1", answer: "staging" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("transitions back to HumanClarificationNeeded (not Failed) when blockers remain but the iteration count is below the max", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1, branchName: null });
    const plan = makePlan({
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
    // Only one prior clarification round so far (below MAX_CLARIFICATION_ITERATIONS=3).
    const events = [asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)];
    const built = buildDeps(run, artifacts, events);
    const svc = new OrchestratorService(built.deps as never);

    const stillBlockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
    });
    built.plannerAgent.run.mockResolvedValue(stillBlockingPlan);

    const result = await svc.answerQuestions(run.id, [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastEvent = built.eventRepo.create.mock.calls.at(-1)?.[0] as {
      eventType: string;
      payloadJson: { iteration: number };
    };
    expect(lastEvent.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(lastEvent.payloadJson.iteration).toBe(2);
  });

  it("forwards prior ResearchedAnswers into the re-plan when present", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1, branchName: null });
    const plan = makePlan({
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
    const researchedAnswers = {
      summary: "s",
      completedAt: new Date().toISOString(),
      answers: [{ questionId: "q0", question: "Q0?", answer: "A0", confidence: "high" as const }],
    };
    const artifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswers }),
    ];
    const built = buildDeps(run, artifacts, []);
    const svc = new OrchestratorService(built.deps as never);

    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.answerQuestions(run.id, [{ questionId: "q1", answer: "staging" }]);

    const callOpts = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOpts.researchedAnswers).toEqual(researchedAnswers.answers);
  });
});

describe("OrchestratorService.runManualPlanRevision -- missing plan and no-note branch", () => {
  it("throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(run, []);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision(run.id)).rejects.toThrow(/No plan artifact found/);
  });

  it("revises without an operator note when opts is omitted", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlan === undefined ? null : {
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important" as const, type: "gap", title: "x", details: "y" }],
      overallVerdict: "changes_requested" as const,
    };
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockImplementation(async (_plan: Plan, _bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: "",
      });
      return planReview;
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "pr-1",
        dispositions: [],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runManualPlanRevision(run.id);

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      run.id,
      undefined,
    );
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode with full prior context", () => {
  it("forwards previousPlan, humanAnswers, researchedAnswers and planReviewFindings from loadReplanContext", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1, branchName: null });
    const rejection: RejectionContextPayload = {
      planVersion: 1,
      feedback: "please fix X",
      source: "api",
      mode: "iterate",
    };
    const prevPlan = makePlan({ planVersion: 1 });
    const artifacts = [
      asArtifact({ type: "RejectionContext", version: 1, payloadJson: rejection }),
      asArtifact({ type: "Plan", version: 1, payloadJson: prevPlan }),
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
      asArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          completedAt: new Date().toISOString(),
          answers: [{ questionId: "q1", question: "Q1?", answer: "A1", confidence: "high" }],
        },
      }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "review summary", findings: [{ id: "f1" }] },
      }),
    ];
    const built = buildDeps(run, artifacts, []);
    const svc = new OrchestratorService(built.deps as never);

    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-x",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.rejectPlan(run.id, "please fix X", "api", "iterate");

    const callOpts = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callOpts.previousPlan).toEqual(prevPlan);
    expect(callOpts.humanAnswers).toEqual([{ questionId: "q1", answer: "yes" }]);
    expect(callOpts.researchedAnswers).toEqual([
      { questionId: "q1", question: "Q1?", answer: "A1", confidence: "high" },
    ]);
    expect(callOpts.planReviewFindings).toEqual({
      summary: "review summary",
      findings: [{ id: "f1" }],
    });
  });
});

describe("OrchestratorService -- maybeResearchAndReplan with prior HumanAnswers", () => {
  it("forwards existing HumanAnswers into both the researcher call and the re-plan call", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const initialPlan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: false }],
    });
    const artifacts = [
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q0", answer: "postgres" }] },
      }),
    ];
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        completedAt: new Date().toISOString(),
        answers: [
          { questionId: "q1", question: "Which DB?", answer: "postgres", confidence: "high" },
        ],
      }),
    };
    const built = buildDeps(run, artifacts, [], { answerResearcherAgent });
    const svc = new OrchestratorService(built.deps as never);

    const secondPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run
      .mockImplementationOnce(async () => initialPlan)
      .mockImplementationOnce(async (_bundle, runId: string) => {
        await built.artifactRepo.create({
          runId,
          type: "Plan",
          version: secondPlan.planVersion,
          payloadJson: secondPlan,
          rawText: "",
        });
        return secondPlan;
      });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      initialPlan,
      expect.anything(),
      run.id,
      { humanAnswers: [{ questionId: "q0", answer: "postgres" }] },
    );
    const replanCallOpts = built.plannerAgent.run.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(replanCallOpts.humanAnswers).toEqual([{ questionId: "q0", answer: "postgres" }]);
  });
});

describe("OrchestratorService.buildTaskBundle -- catch branches with non-Error rejections", () => {
  it("falls back to the configured default branch and omits relatedContext when both GitHub and Linear reject with non-Error values", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(run, []);
    built.githubClient.getDefaultBranch.mockRejectedValue("network blip");
    built.linearClient.getRelatedContext.mockRejectedValue("linear blip");
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async (_bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network blip" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "linear blip" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
    const bundleArg = built.plannerAgent.run.mock.calls[0]?.[0] as {
      repo: { defaultBranch: string };
      relatedContext?: unknown;
    };
    expect(bundleArg.repo.defaultBranch).toBe("main");
    expect(bundleArg.relatedContext).toBeUndefined();
  });
});

describe("OrchestratorService -- comment formatting edge branches via public flows", () => {
  it("formatPlanComment includes a Risks section when the plan has risks", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1, risks: ["Data migration could be lossy"] });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runPlanReview(run.id);

    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Data migration could be lossy");
  });

  it("formatPlanReviewComment includes the affected step id when a finding has one", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps(run, [asArtifact({ type: "Plan", version: 1, payloadJson: plan })]);
    const svc = new OrchestratorService(built.deps as never);

    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing validation",
          details: "details",
        },
      ],
      overallVerdict: "changes_requested",
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "pr-1",
        dispositions: [],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanReview(run.id);

    const reviewComment = built.linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("AI Plan Review"),
    )?.[1] as string;
    expect(reviewComment).toContain("(step s1)");
  });

  it("formatCodeReviewComment includes the line hint when a finding has one", async () => {
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
          lineHint: 42,
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
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview(run.id);

    const comment = built.linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("AI Code Review"),
    )?.[1] as string;
    expect(comment).toContain("src/a.ts:42");
  });
});

describe("OrchestratorService -- distillation catch with a non-Error rejection", () => {
  it("stringifies a non-Error rejection from the distillation agent", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(run, [], [], {
      distillationAgent: { run: vi.fn().mockRejectedValue("not-an-error-object") },
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview(run.id);

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, error: "not-an-error-object" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning query construction and zero-result branch", () => {
  it("builds the relevance query from an empty title/description and does not emit SKILL_INJECTION when zero skills are found", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", linearIssueTitle: null });
    const findTopKByRelevance = vi.fn().mockResolvedValue([]);
    const built = buildDeps(run, [], [], { agentSkillRepo: { findTopKByRelevance } });
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async (_bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.any(String), expect.any(Number));
    const skillInjectionCalls = built.eventRepo.create.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillInjectionCalls).toHaveLength(0);
  });

  it("includes a truncated linearIssueDescription in the relevance query when present", async () => {
    const run = makeRun({
      state: RunState.Todo,
      branchName: "ai/run-1",
      linearIssueTitle: "Fix the bug",
      linearIssueDescription: "a very detailed description of the bug",
    });
    const findTopKByRelevance = vi.fn().mockResolvedValue([]);
    const built = buildDeps(run, [], [], { agentSkillRepo: { findTopKByRelevance } });
    const svc = new OrchestratorService(built.deps as never);

    const plan = makePlan({ openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async (_bundle, runId: string) => {
      await built.artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun(run.id);

    expect(findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("a very detailed description of the bug"),
      expect.any(Number),
    );
  });
});

describe("OrchestratorService -- updateSkillMetrics fallback and non-Error catch branches", () => {
  it("treats a SKILL_INJECTION event with no skillIds as an empty list (?? [] fallback)", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const events = [asEvent("SKILL_INJECTION", { payloadJson: {} })];
    const incrementSuccess = vi.fn();
    const built = buildDeps(run, [], events, {
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility: vi.fn() },
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview(run.id);

    expect(incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error rejection thrown while updating a skill's metrics", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const events = [asEvent("SKILL_INJECTION", { payloadJson: { skillIds: ["s1"] } })];
    const incrementSuccess = vi.fn().mockRejectedValue("skill-db-unreachable");
    const archiveIfLowUtility = vi.fn();
    const built = buildDeps(run, [], events, {
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility },
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview(run.id);

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, skillId: "s1", error: "skill-db-unreachable" }),
      "Failed to update skill metric",
    );
    expect(archiveIfLowUtility).not.toHaveBeenCalled();
  });
});
