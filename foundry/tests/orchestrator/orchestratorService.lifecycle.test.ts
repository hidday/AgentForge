import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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
    prNumber: 42,
    state: RunState.Todo,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Clean",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Wires runRepo.update/updateState to merge onto a single tracked run record,
 * the way a real repository would, so a multi-transition flow (e.g. startRun)
 * sees consistent state across each call instead of a stale fixed mock value.
 */
function wireStatefulRunRepo(runRepo: { update: ReturnType<typeof vi.fn>; updateState: ReturnType<typeof vi.fn> }, initial: Run) {
  let current = initial;
  runRepo.update.mockImplementation((_id: string, patch: Partial<Run>) => {
    current = { ...current, ...patch };
    return Promise.resolve(current);
  });
  runRepo.updateState.mockImplementation((_id: string, state: RunState) => {
    current = { ...current, state };
    return Promise.resolve(current);
  });
  return { get: () => current };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
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
      project: "test-project",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };
  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/x b/x"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({ name: "test-repo", defaultBranch: "main" }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = makeLogger();
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
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
    ...overrides,
  };
}

describe("OrchestratorService.handleLinearWebhook / handleCommand dispatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches comment.command to handleCommand when a command is present", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "approve-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "approve-plan" });
  });

  it("does not dispatch for comment.command with no command payload", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated actions", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("ai-plan and run-ai commands call startRun", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const deps = baseDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-5");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-5");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan forwards the command body to rejectPlan with source linear", async () => {
    const deps = baseDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "not good" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-5", "not good", "linear");
  });

  it("re-review calls runReview for the active run", async () => {
    const deps = baseDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-5");
  });

  it("pause-ai transitions the active run to AIBlocked", async () => {
    const deps = baseDeps();
    const run = makeRun({ id: "run-5", state: RunState.Implementing });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.AIBlocked }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.AIBlocked);
  });

  it("resume-ai transitions the active run back to Todo", async () => {
    const deps = baseDeps();
    const run = makeRun({ id: "run-5", state: RunState.AIBlocked });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.Todo);
  });

  it("logs a warning for an unknown command without taking any action", async () => {
    const deps = baseDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(deps.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts review findings and delegates to runRemediation on changes_requested", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.update.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, prNumber: 42 }),
    );
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "t", details: "d" },
      ],
    });
    deps.reviewerAgent.run.mockResolvedValue(review);
    const commentMap = new Map([["f1", 100]]);
    deps.githubSync.postReviewFindings.mockResolvedValue(commentMap);

    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(run);

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      review.findings,
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 100 });
  });

  it("transitions to approved and calls markReady when the review is clean", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.update.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }),
    );
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    deps.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));

    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("skips posting review findings when the review has no findings, even on changes_requested", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.update.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 42 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    deps.reviewerAgent.run.mockResolvedValue(
      makeReview({ overallVerdict: "changes_requested", findings: [] }),
    );

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(run);

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits remediation changes, syncs GitHub, and calls markReady", async () => {
    const run = makeRun({ state: RunState.AddressingReview, prNumber: 42 });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.update.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    const originalReport = makeExecutionReport({ executionVersion: 1, score: 0.7 });
    const remediation = {
      reviewId: "rev-1",
      resolution: [
        { findingId: "f1", status: "accepted" as const, action: "fixed", rationale: "real bug" },
      ],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    };
    deps.remediationAgent.run.mockResolvedValue(remediation);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type, payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "important", type: "bug", file: "a", title: "t", details: "d" }] }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: originalReport }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runRemediation("run-1", { f1: 100 });

    expect(deps.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(deps.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.executionReport,
    );
    expect(deps.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.resolution,
      { f1: 100 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("skips GitHub sync calls when the run has no PR number", async () => {
    const run = makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.update.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    deps.remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport(),
    });
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type,
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "a", title: "t", details: "d" }],
            }),
          }),
        );
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runRemediation("run-1");

    expect(deps.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(deps.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(deps.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the final ready-for-review comment when policy allows it", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type, payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type, payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    await svc.markReady("run-1");

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("throws when policy preconditions are not met (e.g. no PR)", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow();
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs distillation, transitions to Done, and posts the final comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
  });

  it("swallows a distillation failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("completes without a distillation agent configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("cleans up the worktree and updates skill metrics when the run reaches Done", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/.worktrees/run-1" });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/repo/.worktrees/run-1" }),
    );
    deps.gitService.resolveMainRepoPath.mockReturnValue("/repo");
    deps.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
    ]);
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 1, failureCount: 0, utilityScore: 0.5 }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalled();
  });

  it("skips worktree cleanup when the working directory is already the main repo path", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" });
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo" }));
    deps.gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.startRun", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "existing-run" });
    const deps = baseDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(deps.runRepo.create).not.toHaveBeenCalled();
  });

  it("creates a run, plans, and pauses for clarification when the plan has blocking questions", async () => {
    const deps = baseDeps();
    const createdRun = makeRun({ id: "run-new", state: RunState.Todo, planVersion: 0 });
    deps.runRepo.create.mockResolvedValue(createdRun);
    wireStatefulRunRepo(deps.runRepo, createdRun);
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "What auth method?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(plan);

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
  });

  it("proceeds to plan review when the plan has no blocking questions", async () => {
    const deps = baseDeps();
    const createdRun = makeRun({ id: "run-new", state: RunState.Todo, planVersion: 0 });
    deps.runRepo.create.mockResolvedValue(createdRun);
    wireStatefulRunRepo(deps.runRepo, createdRun);
    deps.plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ id: "run-new", state: RunState.AwaitingPlanApproval }));

    const result = await svc.startRun("LIN-1");

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-new");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects prior skills into the planner call and records a SKILL_INJECTION event when skills are found", async () => {
    const deps = baseDeps();
    const createdRun = makeRun({ id: "run-new", state: RunState.Todo, planVersion: 0, linearIssueTitle: "Fix bug" });
    deps.runRepo.create.mockResolvedValue(createdRun);
    wireStatefulRunRepo(deps.runRepo, createdRun);
    deps.plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const skills = [
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "n",
        description: "d",
        taskCategory: "t",
        skillMarkdown: "m",
        utilityScore: 0.9,
        lastUsedAt: new Date(),
      },
    ];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-new",
      expect.objectContaining({ priorSkills: skills }),
    );
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });
});
