import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord, ArtifactType } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Issue description",
    linearIssueTitle: "Issue title",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan summary",
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Plan looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks green",
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

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
      repoPath: "/tmp/repo",
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
    ...overrides,
  };
}

function makeArtifact(type: ArtifactType, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

interface BuildOpts {
  run: Run;
  artifacts?: Artifact[];
  events?: RunEventRecord[];
  withAgentSkillRepo?: boolean;
  withAnswerResearcher?: boolean;
  distillation?: "absent" | "success" | "throws";
  linearClientOverrides?: Record<string, unknown>;
  githubClientOverrides?: Record<string, unknown>;
}

function buildDeps(opts: BuildOpts) {
  let current: Run = { ...opts.run };
  const artifactStore: Artifact[] = [...(opts.artifacts ?? [])];
  const eventStore: RunEventRecord[] = [...(opts.events ?? [])];

  const runRepo = {
    findById: vi.fn(async () => ({ ...current })),
    findActiveByIssueId: vi.fn(async () => null),
    findAll: vi.fn(),
    create: vi.fn(async (params: Partial<Run>) => {
      current = { ...current, ...params, state: RunState.Todo };
      return { ...current };
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn(async (_id: string, state: RunState) => {
      current = { ...current, state };
      return { ...current };
    }),
    update: vi.fn(async (_id: string, data: Partial<Run>) => {
      current = { ...current, ...data };
      return { ...current };
    }),
  };

  const artifactRepo = {
    create: vi.fn(async (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown; rawText: string }) => {
      const a = makeArtifact(params.type, params.version, params.payloadJson);
      artifactStore.push(a);
      return a;
    }),
    findByRunId: vi.fn(async () => [...artifactStore]),
    findLatestByType: vi.fn(async (_runId: string, type: ArtifactType) => {
      const matching = artifactStore.filter((a) => a.type === type);
      if (matching.length === 0) return null;
      return matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
    }),
  };

  const eventRepo = {
    create: vi.fn(async (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${eventStore.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      eventStore.push(e);
      return e;
    }),
    findByRunId: vi.fn(async () => [...eventStore]),
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
    ...opts.linearClientOverrides,
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    ...opts.githubClientOverrides,
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // The real agents persist their own artifacts as a side effect of running
  // (see e.g. src/agents/plannerAgent.ts, executorAgent.ts, reviewerAgent.ts).
  // Since the agents themselves are mocked here, each default mock implementation
  // replicates that side effect by writing through the (also mocked) artifactRepo,
  // so that downstream artifactRepo.findLatestByType lookups succeed exactly as
  // they would against the real agents.
  const plannerAgent = {
    run: vi.fn(async () => {
      const plan = makePlan();
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn(async () => {
      const planReview = makePlanReview();
      await artifactRepo.create({
        runId: "run-1",
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: JSON.stringify(planReview),
      });
      return planReview;
    }),
  };
  const planReviserAgent = {
    run: vi.fn(async () => {
      const revision = { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] };
      const revisedPlan = makePlan({ planVersion: 2 });
      await artifactRepo.create({
        runId: "run-1",
        type: "PlanRevision",
        version: 1,
        payloadJson: revision,
        rawText: JSON.stringify(revision),
      });
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: revisedPlan.planVersion,
        payloadJson: revisedPlan,
        rawText: JSON.stringify(revisedPlan),
      });
      return { revision, revisedPlan };
    }),
  };
  const executorAgent = {
    run: vi.fn(async () => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    }),
  };
  const reviewerAgent = {
    run: vi.fn(async () => {
      const review = makeReview();
      await artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    }),
  };
  const remediationAgent = {
    run: vi.fn(async (_review: unknown, executionReport: ExecutionReport) => {
      const newReport = makeExecutionReport({ executionVersion: executionReport.executionVersion + 1 });
      const remediation = {
        reviewId: "rev-1",
        resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "ok" }],
        readyForHumanReview: true,
        executionReport: newReport,
      } as Remediation;
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: newReport.executionVersion,
        payloadJson: newReport,
        rawText: JSON.stringify(newReport),
      });
      await artifactRepo.create({
        runId: "run-1",
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
        rawText: JSON.stringify(remediation),
      });
      return remediation;
    }),
  };

  function setPlan(plan: Plan) {
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

  function setPlanReview(planReview: PlanReview) {
    planReviewerAgent.run.mockImplementation(async () => {
      await artifactRepo.create({
        runId: "run-1",
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: JSON.stringify(planReview),
      });
      return planReview;
    });
  }

  function setReview(review: Review) {
    reviewerAgent.run.mockImplementation(async () => {
      await artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    });
  }

  function setExecutorResult(result: { report: ExecutionReport; prNumber: number }) {
    executorAgent.run.mockImplementation(async () => {
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: result.report.executionVersion,
        payloadJson: result.report,
        rawText: JSON.stringify(result.report),
      });
      return result;
    });
  }

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/repo"),
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

  const agentSkillRepo = opts.withAgentSkillRepo
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([
          { id: "skill-1", repoSlug: "test-repo", name: "s1", description: "d", taskCategory: "auth", skillMarkdown: "md", utilityScore: 0.5, lastUsedAt: new Date() },
        ]),
        incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 1, failureCount: 0, utilityScore: 0.5 }),
        incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0.1 }),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      }
    : undefined;

  const answerResearcherAgent = opts.withAnswerResearcher
    ? { run: vi.fn().mockResolvedValue({ summary: "s", answers: [], completedAt: new Date().toISOString() }) }
    : undefined;

  let distillationAgent;
  if (opts.distillation === "success") {
    distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
  } else if (opts.distillation === "throws") {
    distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
  } else {
    distillationAgent = undefined;
  }

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
    logger,
    dashboardEmitter,
    agentSkillRepo,
    distillationAgent,
    answerResearcherAgent,
  };

  return {
    deps,
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
    agentSkillRepo,
    distillationAgent,
    artifactStore,
    eventStore,
    getCurrentRun: () => current,
    setPlan,
    setPlanReview,
    setReview,
    setExecutorResult,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("ignores issue.created", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores issue.updated", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("dispatches to handleCommand when action is comment.command and a command is present", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "approve-plan" } as never,
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "approve-plan" });
  });

  it("does nothing for comment.command when no command is attached", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan dispatches to startRun", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as never);

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai dispatches to startRun", async () => {
    const built = buildDeps({ run: makeRun() });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" } as never);

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: when an active run exists, approves it and starts execution", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(approveSpy).toHaveBeenCalledWith("run-1");
    expect(execSpy).toHaveBeenCalledWith("run-1");
  });

  it("approve-plan: no-op when no active run exists for the issue", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: dispatches to rejectPlan with linear source when an active run exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "no good" } as never);

    expect(rejectSpy).toHaveBeenCalledWith("run-1", "no good", "linear");
  });

  it("reject-plan: no-op when no active run exists", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);
    const rejectSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" } as never);

    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("re-review: dispatches to runReview when an active run exists", async () => {
    const run = makeRun({ state: RunState.AIReview });
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("re-review: no-op when no active run exists", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions the active run to AIBlocked via BLOCKED", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(built.getCurrentRun().state).toBe(RunState.AIBlocked);
    const eventTypes = built.eventStore.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.BLOCKED);
  });

  it("pause-ai: no-op when no active run exists", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(built.eventStore).toHaveLength(0);
  });

  it("resume-ai: transitions the active run back to Todo via RESET_TO_TODO", async () => {
    const run = makeRun({ state: RunState.AIBlocked });
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(built.getCurrentRun().state).toBe(RunState.Todo);
    const eventTypes = built.eventStore.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
  });

  it("resume-ai: no-op when no active run exists", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(built.eventStore).toHaveLength(0);
  });

  it("unknown: logs a warning and takes no action", async () => {
    const built = buildDeps({ run: makeRun() });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" } as never);

    expect(built.logger.warn).toHaveBeenCalled();
    expect(built.eventStore).toHaveLength(0);
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "existing-run", state: RunState.Planning });
    const built = buildDeps({ run: existing });
    built.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.id).toBe("existing-run");
    expect(built.runRepo.create).not.toHaveBeenCalled();
    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("happy path with no blocking questions: creates run, sets up worktree, plans, and reaches AwaitingPlanApproval", async () => {
    const run = makeRun();
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlan(makePlan({ openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(built.runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: "LIN-1", repo: "test-repo" }),
    );
    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(built.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const taskBundleArtifacts = built.artifactStore.filter((a) => a.type === "TaskBundle");
    expect(taskBundleArtifacts).toHaveLength(1);
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const run = makeRun();
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlan(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = built.eventStore.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("injects prior skills when agentSkillRepo is configured and records a SKILL_INJECTION event", async () => {
    const run = makeRun();
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(built.agentSkillRepo?.findTopKByRelevance).toHaveBeenCalled();
    const eventTypes = built.eventStore.map((e) => e.eventType);
    expect(eventTypes).toContain("SKILL_INJECTION");
    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: expect.any(Array) }),
    );
  });

  it("uses the remote default branch from GitHub when it differs from config, and warns", async () => {
    const run = makeRun();
    const built = buildDeps({
      run,
      githubClientOverrides: { getDefaultBranch: vi.fn().mockResolvedValue("trunk") },
    });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundleArg = built.plannerAgent.run.mock.calls[0][0] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("trunk");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "trunk" }),
      expect.stringContaining("defaultBranch differs"),
    );
  });

  it("keeps the config default branch when GitHub's matches it (no warning)", async () => {
    const run = makeRun();
    const built = buildDeps({
      run,
      githubClientOverrides: { getDefaultBranch: vi.fn().mockResolvedValue("main") },
    });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundleArg = built.plannerAgent.run.mock.calls[0][0] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("main");
    const warnCalls = built.logger.warn.mock.calls.filter((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("defaultBranch differs"),
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("falls back to the config default branch when GitHub lookup throws", async () => {
    const run = makeRun();
    const built = buildDeps({
      run,
      githubClientOverrides: { getDefaultBranch: vi.fn().mockRejectedValue(new Error("rate limited")) },
    });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundleArg = built.plannerAgent.run.mock.calls[0][0] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("main");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "rate limited" }),
      expect.stringContaining("Failed to resolve default branch"),
    );
  });

  it("forwards relatedContext onto the TaskBundle when the issue has a parent or blockers", async () => {
    const run = makeRun();
    const relatedContext = {
      parent: { id: "p1", title: "Parent", description: "d", state: "Todo", labels: [], priority: 1 },
      blockers: [],
    };
    const built = buildDeps({
      run,
      linearClientOverrides: { getRelatedContext: vi.fn().mockResolvedValue(relatedContext) },
    });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundleArg = built.plannerAgent.run.mock.calls[0][0] as TaskBundle;
    expect(bundleArg.relatedContext?.parent?.id).toBe("p1");
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior artifacts (rejection context, previous plan, human answers, researched answers, plan review) and proceeds to AI review", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const artifacts = [
      makeArtifact("RejectionContext", 1, { planVersion: 1, feedback: "fix it", source: "api", mode: "iterate" }),
      makeArtifact("Plan", 1, makePlan({ planVersion: 1 })),
      makeArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }),
      makeArtifact("ResearchedAnswers", 1, {
        summary: "s",
        answers: [{ questionId: "q1", question: "?", answer: "a", confidence: "high" }],
        completedAt: new Date().toISOString(),
      }),
      makeArtifact("PlanReview", 1, { summary: "needs work", findings: [] }),
    ];
    const built = buildDeps({ run, artifacts });
    built.setPlan(makePlan({ planVersion: 2, openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "fix it" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "?", answer: "a", confidence: "high" }],
        planReviewFindings: { summary: "needs work", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("re-plans with none of the optional prior-context artifacts present", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps({ run });
    built.setPlan(makePlan({ planVersion: 2, openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanning("run-1");

    const callOpts = built.plannerAgent.run.mock.calls[0][2];
    expect(callOpts).not.toHaveProperty("humanFeedback");
    expect(callOpts).not.toHaveProperty("humanAnswers");
    expect(callOpts).not.toHaveProperty("researchedAnswers");
    expect(callOpts).not.toHaveProperty("planReviewFindings");
  });

  it("pauses for clarification again when the re-plan still has blocking questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps({ run });
    built.setPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const run = makeRun({ state: RunState.AIBlocked, branchName: null });
    const built = buildDeps({ run });
    built.setPlan(makePlan({ openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(built.getCurrentRun().branchName).toBe("ai/run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const run = makeRun({ state: RunState.AIBlocked, branchName: "ai/existing" });
    const built = buildDeps({ run });
    built.setPlan(makePlan({ openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the re-plan has blocking questions", async () => {
    const run = makeRun({ state: RunState.AIBlocked, branchName: "ai/existing" });
    const built = buildDeps({ run });
    built.setPlan(
      makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("approved verdict: transitions to AwaitingPlanApproval and posts an approval comment", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI plan review"),
    );
    expect(comment?.[1]).toContain("approved");
  });

  it("changes_requested verdict: transitions to PlanRevision and chains into runPlanRevision", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const planArtifacts = built.artifactStore.filter((a) => a.type === "PlanReview");
    expect(planArtifacts.length).toBeGreaterThanOrEqual(0);
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const built = buildDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions to AwaitingPlanApproval, and posts combined comment", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const artifacts = [
      makeArtifact("Plan", 1, makePlan({ planVersion: 1 })),
      makeArtifact("PlanReview", 1, makePlanReview({ overallVerdict: "changes_requested" })),
    ];
    const built = buildDeps({ run, artifacts });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.getCurrentRun().planVersion).toBe(2);
    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("Plan Revision Dispositions");
  });

  it("forwards an operator note to the plan reviser agent when provided", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const artifacts = [
      makeArtifact("Plan", 1, makePlan({ planVersion: 1 })),
      makeArtifact("PlanReview", 1, makePlanReview({ overallVerdict: "changes_requested" })),
    ];
    const built = buildDeps({ run, artifacts });
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanRevision("run-1", { note: "please hurry" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
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
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const artifacts = [makeArtifact("Plan", 2, makePlan({ planVersion: 2 }))];
    const built = buildDeps({ run, artifacts });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(built.getCurrentRun().approvedPlanVersion).toBe(2);
    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const artifacts = [makeArtifact("Plan", 2, makePlan({ planVersion: 2 }))];
    const built = buildDeps({ run, artifacts });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "ship it fast" });

    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("ship it fast");
  });

  it("throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run");
  });
});

describe("OrchestratorService.runExecution", () => {
  function execDeps(runOverrides: Partial<Run> = {}, artifacts: Artifact[] = []) {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      ...runOverrides,
    });
    const allArtifacts = [makeArtifact("Plan", 1, makePlan({ planVersion: 1 })), ...artifacts];
    return buildDeps({ run, artifacts: allArtifacts });
  }

  it("rejects via policy when the run is not in Implementing state", async () => {
    const built = execDeps({ state: RunState.PlanReview });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("happy path: runs executor, persists PR number, transitions to AIReview, then proceeds to review", async () => {
    const built = execDeps();
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(built.getCurrentRun().prNumber).toBe(42);
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/repo",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    // runReview chained through to markReady (review approved -> Done-adjacent ReadyForHumanReview)
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the pre-executor checkpoint commit when the run has no branchName", async () => {
    const built = execDeps({ branchName: null });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining("checkpoint"),
    );
  });

  it("AgentTimeoutError: records EXECUTION_TIMEOUT, blocks the run, and posts a timeout comment without rethrowing", async () => {
    const built = execDeps();
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 60_000));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEvent = built.eventStore.find((e) => e.eventType === "EXECUTION_TIMEOUT");
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent?.payloadJson as { agent: string }).agent).toBe("executor");
    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("timed out after 1 minutes");
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const built = execDeps();
    built.executorAgent.run.mockRejectedValue(new Error("executor crashed"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
  });

  it("enforces executor path policy: throws when protected paths are touched", async () => {
    const built = execDeps();
    built.setExecutorResult({
      report: makeExecutionReport({ filesChanged: ["node_modules/evil.js"] }),
      prNumber: 42,
    });
    built.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["node_modules/"],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    // Run never reaches EXECUTION_FINISHED
    expect(built.getCurrentRun().state).toBe(RunState.Implementing);
  });

  it("crash recovery: skips re-running the executor when an ExecutionReport exists after the last EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-01T00:05:00Z");
    const report = makeExecutionReport();
    const built = execDeps(
      { prNumber: 42 },
      [makeArtifact("ExecutionReport", 1, report)],
    );
    // Force the report's createdAt to be after the EXECUTION_STARTED event.
    built.artifactStore.find((a) => a.type === "ExecutionReport")!.createdAt = t2;
    built.eventStore.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: t1,
    });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    const finishedEvent = built.eventStore.find(
      (e) => e.eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(finishedEvent).toBeDefined();
    expect((finishedEvent?.payloadJson as { recovered?: boolean }).recovered).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("crash recovery NOT triggered when EXECUTION_FINISHED already happened after the report: runs executor normally", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-01T00:05:00Z");
    const t3 = new Date("2026-01-01T00:10:00Z");
    const report = makeExecutionReport();
    const built = execDeps(
      { prNumber: 42 },
      [makeArtifact("ExecutionReport", 1, report)],
    );
    built.artifactStore.find((a) => a.type === "ExecutionReport")!.createdAt = t2;
    built.eventStore.push(
      {
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: t1,
      },
      {
        id: "evt-finished",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: t3,
      },
    );
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("crash recovery NOT triggered when there is no prior EXECUTION_STARTED event: runs executor normally", async () => {
    const report = makeExecutionReport();
    const built = execDeps(
      { prNumber: 42 },
      [makeArtifact("ExecutionReport", 1, report)],
    );
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.runReview", () => {
  function reviewDeps(runOverrides: Partial<Run> = {}, extraArtifacts: Artifact[] = []) {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42, ...runOverrides });
    const artifacts = [
      makeArtifact("Plan", 1, makePlan({ planVersion: 1 })),
      makeArtifact("ExecutionReport", 1, makeExecutionReport()),
      ...extraArtifacts,
    ];
    return buildDeps({ run, artifacts });
  }

  it("approved verdict: transitions to ReadyForHumanReview via markReady", async () => {
    const built = reviewDeps();
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
  });

  it("changes_requested verdict with findings: posts findings to GitHub and chains into remediation", async () => {
    const built = reviewDeps();
    built.setReview(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
      }),
    );
    built.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      "changes_requested",
    );
    expect(built.remediationAgent.run).toHaveBeenCalled();
  });

  it("does not post findings to GitHub when there is no PR number", async () => {
    const built = reviewDeps({ prNumber: null });
    built.setReview(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    // assertCanRemediate requires a review to exist with changes_requested; it will proceed
    // but policy.assertCanReview does not require a PR, so this still runs through runReview.
    await svc.runReview("run-1").catch(() => undefined);

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("uses an empty diff when the run has no PR number", async () => {
    const built = reviewDeps({ prNumber: null });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).not.toHaveBeenCalled();
    expect(built.reviewerAgent.run.mock.calls[0][2]).toBe("");
  });

  it("throws via policy when there is no execution report", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps({ run, artifacts: [makeArtifact("Plan", 1, makePlan())] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runRemediation", () => {
  function remediationDeps(runOverrides: Partial<Run> = {}) {
    const run = makeRun({
      state: RunState.AddressingReview,
      branchName: "ai/run-1",
      prNumber: 42,
      ...runOverrides,
    });
    const artifacts = [
      makeArtifact("ExecutionReport", 1, makeExecutionReport()),
      makeArtifact(
        "Review",
        1,
        makeReview({
          overallVerdict: "changes_requested",
          findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
        }),
      ),
    ];
    return buildDeps({ run, artifacts });
  }

  it("persists the new ExecutionReport, commits, syncs GitHub, and ultimately fails markReady because the Review verdict was never re-approved (known limitation)", async () => {
    const built = remediationDeps();
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/repo", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/repo",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalled();

    const eventTypes = built.eventStore.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
  });

  it("skips branch assertion/commit and GitHub sync when the run has no branchName or PR", async () => {
    const built = remediationDeps({ branchName: null, prNumber: null });
    const svc = new OrchestratorService(built.deps as never);

    await svc.runRemediation("run-1").catch(() => undefined);

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("rejects via policy when there is no changes_requested Review", async () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const built = buildDeps({ run, artifacts: [makeArtifact("ExecutionReport", 1, makeExecutionReport())] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts a completion comment when all policy checks pass", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const artifacts = [
      makeArtifact("ExecutionReport", 1, makeExecutionReport()),
      makeArtifact("Review", 1, makeReview({ overallVerdict: "approved" })),
    ];
    const built = buildDeps({ run, artifacts });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady("run-1");

    expect(result).toBeDefined();
    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("Ready for Human Review");
  });

  it("throws and posts no comment when policy rejects (e.g. no PR)", async () => {
    const run = makeRun({ prNumber: null });
    const built = buildDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
    expect(built.linearClient.postComment).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions via PLAN_REVIEW_APPROVED and returns to AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "nit", type: "style", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("forwards an operator note to the plan reviewer agent and records it on the transition payload", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runManualReReview("run-1", { note: "double-check security" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double-check security" },
    );
    const reReviewEvent = built.eventStore.find((e) => e.eventType === RunEvent.RE_REVIEW_REQUESTED);
    expect((reReviewEvent?.payloadJson as { note?: string }).note).toBe("double-check security");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: no revision needed, stays at AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const artifacts = [makeArtifact("Plan", 1, makePlan())];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: triggers runPlanRevision, forwarding the operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const artifacts = [
      makeArtifact("Plan", 1, makePlan({ planVersion: 1 })),
      makeArtifact("PlanReview", 1, makePlanReview({ overallVerdict: "changes_requested" })),
    ];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.getCurrentRun().planVersion).toBe(2);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done and posts a completion comment when there is no distillation agent", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "absent" });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const comment = built.linearClient.postComment.mock.calls.at(-1)?.[1] as string;
    expect(comment).toContain("Done");
  });

  it("runs the distillation agent before transitioning when configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "success" });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.distillationAgent?.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "throws" });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });
});

describe("OrchestratorService transitionAndRecord side-effects on terminal states", () => {
  it("cleans up the worktree when the run reaches Done and the working directory differs from the main repo", async () => {
    const run = makeRun({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/repo/.worktrees/run-1",
    });
    const built = buildDeps({ run, distillation: "absent" });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/repo");
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "/tmp/repo/.worktrees/run-1",
    );
  });

  it("does NOT remove the worktree when the working directory IS the main repo path", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/repo" });
    const built = buildDeps({ run, distillation: "absent" });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/repo");
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("updates skill metrics (success) on reaching Done when an agentSkillRepo is configured and skills were injected", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "absent", withAgentSkillRepo: true });
    built.eventStore.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.agentSkillRepo?.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo?.archiveIfLowUtility).toHaveBeenCalled();
  });

  it("updates skill metrics (failure) on reaching Failed, deduplicating skill IDs across multiple injection events", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const artifacts = [
      makeArtifact(
        "Plan",
        1,
        makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }),
      ),
    ];
    const built = buildDeps({ run, artifacts, withAgentSkillRepo: true });
    built.eventStore.push(
      {
        id: "evt-injection-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "evt-injection-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
      // 3 prior NEEDS_HUMAN_CLARIFICATION events so the next one exhausts the limit
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `evt-clarify-${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      })),
    );
    const svc = new OrchestratorService(built.deps as never);

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(built.getCurrentRun().state).toBe(RunState.Failed);
    // skill-1 appears in both injection events but must only be updated once.
    expect(built.agentSkillRepo?.incrementFailure).toHaveBeenCalledTimes(2);
    expect(built.agentSkillRepo?.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo?.incrementFailure).toHaveBeenCalledWith("skill-2");
  });

  it("tolerates a skill metric update failure for one skill and continues with the rest", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "absent", withAgentSkillRepo: true });
    built.agentSkillRepo!.incrementSuccess
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce({ id: "skill-2", successCount: 1, failureCount: 0, utilityScore: 0.5 });
    built.eventStore.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db hiccup" }),
      expect.stringContaining("Failed to update skill metric"),
    );
    expect(built.agentSkillRepo?.incrementSuccess).toHaveBeenCalledTimes(2);
  });

  it("does nothing for skill metrics when no SKILL_INJECTION events were recorded", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "absent", withAgentSkillRepo: true });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.agentSkillRepo?.incrementSuccess).not.toHaveBeenCalled();
  });

  it("does nothing for skill metrics when there is no agentSkillRepo configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, distillation: "absent" });
    built.eventStore.push({
      id: "evt-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(built.deps as never);

    // Should not throw even though agentSkillRepo is undefined.
    const result = await svc.approveHumanReview("run-1");
    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService.rejectPlan fresh mode", () => {
  it("does not load prior replan context (no previousPlan/humanAnswers/etc injected) when mode is 'fresh'", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const artifacts = [
      makeArtifact("Plan", 2, makePlan({ planVersion: 2 })),
      makeArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }),
    ];
    const built = buildDeps({ run, artifacts });
    built.setPlan(makePlan({ planVersion: 3, openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    const callOpts = built.plannerAgent.run.mock.calls[0][2];
    expect(callOpts).not.toHaveProperty("previousPlan");
    expect(callOpts).not.toHaveProperty("humanAnswers");
    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Plan rejected"),
    );
    expect(comment?.[1]).toContain("Plan rejected (fresh)");
  });
});

describe("OrchestratorService comment formatting via public flows", () => {
  it("includes open questions and risks in the plan comment when present", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: false }],
      risks: ["Might break CI"],
    });
    const artifacts = [makeArtifact("Plan", 1, plan)];
    const built = buildDeps({ run, artifacts });
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanReview("run-1");

    const approvalComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan"),
    )?.[1] as string;
    expect(approvalComment).toContain("Open Questions");
    expect(approvalComment).toContain("Which DB?");
    expect(approvalComment).toContain("Risks");
    expect(approvalComment).toContain("Might break CI");
  });

  it("collapses the files-changed list inside <details> when more than 8 files changed", async () => {
    const built = execDepsHelper();
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    built.setExecutorResult({
      report: makeExecutionReport({ filesChanged: manyFiles, notes: ["Note A"] }),
      prNumber: 42,
    });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    const execComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(execComment).toContain("<details>");
    expect(execComment).toContain("Files changed (9)");
    expect(execComment).toContain("### Notes");
    expect(execComment).toContain("Note A");
  });

  it("does not render a files section when no files changed, and omits the notes section when there are no notes", async () => {
    const built = execDepsHelper();
    built.setExecutorResult({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 42,
    });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    const execComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(execComment).not.toContain("Files changed");
    expect(execComment).not.toContain("### Notes");
  });

  function execDepsHelper() {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" });
    const artifacts = [makeArtifact("Plan", 1, makePlan({ planVersion: 1 }))];
    return buildDeps({ run, artifacts });
  }
});
