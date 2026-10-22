import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { PlanRevision } from "../../src/schemas/planRevision.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
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
    latestArtifactVersion: 0,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Initial implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "summary",
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

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeStore(initialRun: Run): TestStore {
  return { run: initialRun, artifacts: [], events: [] };
}

let eventSeq = 0;

function buildDeps(store: TestStore, opts: { withAgentSkillRepo?: boolean } = {}) {
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
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
        const a = asArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        eventSeq += 1;
        const evt: RunEventRecord = {
          id: `evt-${eventSeq}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? {},
          createdAt: new Date(Date.now() + eventSeq),
        };
        store.events.push(evt);
        return Promise.resolve(evt);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Issue title",
      description: "Issue description",
      branchName: "ai/run-1",
      labels: [],
      priority: 1,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
  };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // The real agent classes persist their own artifacts via their injected
  // artifactRepo before returning. These test doubles replicate that side
  // effect so that orchestrator code reading artifacts back (e.g.
  // runPlanReview looking up the latest "Plan") sees consistent state.
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  function setPlannerPlan(plan: Plan): void {
    plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(
        asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }),
      );
      return plan;
    });
  }

  function setPlanReviewerResult(planReview: PlanReview): void {
    planReviewerAgent.run.mockImplementation(async () => {
      store.artifacts.push(
        asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      );
      return planReview;
    });
  }

  function setPlanReviserResult(revision: PlanRevision, revisedPlan: Plan): void {
    planReviserAgent.run.mockImplementation(async () => {
      store.artifacts.push(
        asArtifact({ type: "PlanRevision", version: 1, payloadJson: revision }),
      );
      store.artifacts.push(
        asArtifact({ type: "Plan", version: revisedPlan.planVersion, payloadJson: revisedPlan }),
      );
      return { revision, revisedPlan };
    });
  }

  function setExecutorResult(report: ExecutionReport, prNumber: number): void {
    executorAgent.run.mockImplementation(async () => {
      store.artifacts.push(
        asArtifact({ type: "ExecutionReport", version: report.executionVersion, payloadJson: report }),
      );
      return { report, prNumber };
    });
  }

  function setReviewerResult(review: Review): void {
    reviewerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });
  }

  function setRemediationResult(remediation: {
    reviewId: string;
    resolution: unknown[];
    readyForHumanReview: boolean;
    executionReport: ExecutionReport;
  }): void {
    remediationAgent.run.mockImplementation(async () => {
      store.artifacts.push(
        asArtifact({
          type: "ExecutionReport",
          version: remediation.executionReport.executionVersion,
          payloadJson: remediation.executionReport,
        }),
      );
      store.artifacts.push(asArtifact({ type: "Remediation", version: 1, payloadJson: remediation }));
      return remediation;
    });
  }

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
          {
            id: "skill-1",
            repoSlug: "test-repo",
            name: "helper",
            description: "desc",
            taskCategory: "general",
            skillMarkdown: "# md",
            utilityScore: 0.5,
            lastUsedAt: new Date(),
          },
        ]),
        incrementSuccess: vi.fn().mockResolvedValue({
          id: "skill-1",
          successCount: 1,
          failureCount: 0,
          utilityScore: 0.5,
        }),
        incrementFailure: vi.fn().mockResolvedValue({
          id: "skill-1",
          successCount: 0,
          failureCount: 1,
          utilityScore: 0.3,
        }),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
    githubClient,
    githubSync,
    gitService,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    distillationAgent,
    logger,
    agentSkillRepo,
    setPlannerPlan,
    setPlanReviewerResult,
    setPlanReviserResult,
    setExecutorResult,
    setReviewerResult,
    setRemediationResult,
  };
}

describe("OrchestratorService -- simple getters", () => {
  it("expose the injected repositories and clients", () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getLinearClient()).toBe(built.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("getAgentSkillRepo returns the injected repo when provided", () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store, { withAgentSkillRepo: true });
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getAgentSkillRepo()).toBe(built.agentSkillRepo);
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command payload to handleCommand", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown" },
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "unknown" });
  });

  it("does nothing for comment.command with no command payload", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["issue.created", "issue.updated"])(
    "is a no-op for %s action",
    async (action) => {
      const store = makeStore(makeRun());
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);

      await expect(svc.handleLinearWebhook({ action, issueId: "LIN-1" })).resolves.toBeUndefined();
    },
  );
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan and run-ai both delegate to startRun", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
  });

  it("approve-plan looks up the active run, approves the plan, then starts execution", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const svc = new OrchestratorService(built.deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-1");
    expect(execSpy).toHaveBeenCalledWith("run-1");
  });

  it("approve-plan is a no-op when there is no active run for the issue", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject-plan forwards the comment body as rejection context", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const svc = new OrchestratorService(built.deps as never);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectSpy).toHaveBeenCalledWith("run-1", "needs more detail", "linear");
  });

  it("re-review triggers runReview for the active run", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const svc = new OrchestratorService(built.deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pause-ai records a BLOCKED transition for the active run", async () => {
    const store = makeStore(makeRun({ id: "run-1", state: RunState.Implementing }));
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(store.run.state).toBe(RunState.AIBlocked);
  });

  it("resume-ai resets the active run to Todo", async () => {
    const store = makeStore(makeRun({ id: "run-1", state: RunState.AIBlocked }));
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(store.run.state).toBe(RunState.Todo);
  });

  it("logs a warning and takes no action for an unknown command", async () => {
    const store = makeStore(makeRun());
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun -- dedup", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "existing-run", state: RunState.Implementing });
    const store = makeStore(existing);
    const built = buildDeps(store);
    built.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(existing);
    expect(built.runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning (re-plan from Todo after rejection)", () => {
  it("re-plans using prior plan + rejection context and proceeds to plan review when no blocking questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const store = makeStore(run);
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({
        type: "RejectionContext",
        version: 1,
        payloadJson: { planVersion: 1, feedback: "please add tests", source: "api", mode: "fresh" },
      }),
    );
    const built = buildDeps(store);
    built.setPlannerPlan(makePlan({ planVersion: 2 }));
    built.setPlanReviewerResult(makePlanReview());
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "please add tests" },
      }),
    );
    // Planning (2) -> PlanReview (PLAN_CREATED) -> AwaitingPlanApproval (PLAN_REVIEW_APPROVED)
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
  });

  it("pauses for human clarification when the re-plan has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const store = makeStore(run);
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.setPlannerPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a fresh worktree when the run has no branch yet", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const store = makeStore(run);
    const built = buildDeps(store);
    built.setPlannerPlan(makePlan({ planVersion: 1 }));
    built.setPlanReviewerResult(makePlanReview());
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(result.branchName).toBe("ai/run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branch", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/already-exists" });
    const store = makeStore(run);
    const built = buildDeps(store);
    built.setPlannerPlan(makePlan({ planVersion: 1 }));
    built.setPlanReviewerResult(makePlanReview());
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the retried plan has blocking questions", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const store = makeStore(run);
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const store = makeStore(makeRun({ state: RunState.PlanReview }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found");
  });

  it("transitions to AwaitingPlanApproval and posts a comment when review is approved", async () => {
    const store = makeStore(makeRun({ state: RunState.PlanReview }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("falls through to plan revision when review requests changes", async () => {
    const store = makeStore(makeRun({ state: RunState.PlanReview, planVersion: 1 }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "gap",
            title: "Missing step",
            details: "No rollback plan",
          },
        ],
      }),
    );
    const revisedPlan = makePlan({ planVersion: 2 });
    const revision: PlanRevision = {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "pr-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Added rollback step" }],
    };
    built.planReviserAgent.run.mockResolvedValue({ revision, revisedPlan });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
  });

  it("passes an operator note through to the plan reviser", async () => {
    const store = makeStore(makeRun({ state: RunState.PlanRevision, planVersion: 1 }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
      }),
    );
    const built = buildDeps(store);
    const revisedPlan = makePlan({ planVersion: 2 });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "pr-1",
        dispositions: [],
      },
      revisedPlan,
    });
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
  it("throws when there is no Plan artifact for the run", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain comment with no note", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.approvedPlanVersion).toBe(1);
    expect(result.state).toBe(RunState.Implementing);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.not.stringContaining("operator note"),
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "ship it carefully" });

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("ship it carefully"),
    );
  });
});

describe("OrchestratorService.runExecution", () => {
  it("rejects via PolicyEngine when the run is not in Implementing state", async () => {
    const store = makeStore(makeRun({ state: RunState.Todo, approvedPlanVersion: 1 }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("runs the executor, persists the PR number, and proceeds to review", async () => {
    const store = makeStore(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
    );
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    const report = makeExecutionReport();
    built.setExecutorResult(report, 7);
    built.setReviewerResult(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).toHaveBeenCalled();
    expect(store.run.prNumber).toBe(7);
    expect(store.run.executorRuntime).toBe("claude-code");
    // runExecution hands off to runReview -> approved verdict -> markReady
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("recovers a stranded execution (report exists, EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const store = makeStore(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 9 }),
    );
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    // An EXECUTION_STARTED event exists, but no EXECUTION_FINISHED after it.
    store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(Date.now() - 1000),
    });
    const built = buildDeps(store);
    built.setReviewerResult(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("blocks the run and posts a comment when the executor times out", async () => {
    const store = makeStore(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
    );
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
  });

  it("rethrows a non-timeout error from the executor", async () => {
    const store = makeStore(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: "ai/run-1" }),
    );
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const built = buildDeps(store);
    built.executorAgent.run.mockRejectedValue(new Error("disk full"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("disk full");
  });
});

describe("OrchestratorService.runReview", () => {
  it("fetches the PR diff and posts review findings to GitHub when there are findings", async () => {
    const store = makeStore(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    const built = buildDeps(store);
    built.setReviewerResult(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "a.ts",
            title: "bug",
            details: "details",
          },
        ],
      }),
    );
    built.setRemediationResult({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: false,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });
    const svc = new OrchestratorService(built.deps as never);

    // Pre-existing behaviour (also documented in
    // orchestratorService.executionScore.test.ts): runRemediation always
    // calls markReady() at the end, but the Review artifact it reads back
    // is still the original "changes_requested" one (remediation does not
    // create a fresh "approved" Review). So markReady's verdict check is
    // expected to throw here; we assert on the side effects that already
    // happened before that throw.
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 7);
    expect(built.githubSync.postReviewFindings).toHaveBeenCalled();
    // The remediation lane's own transitions (REMEDIATION_FINISHED,
    // REVIEW_APPROVED) already ran by the time markReady's policy check throws.
    expect(store.run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("goes straight to markReady (skipping remediation) when the review is approved", async () => {
    const store = makeStore(makeRun({ state: RunState.AIReview, prNumber: 1 }));
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    const built = buildDeps(store);
    built.setReviewerResult(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runReview("run-1");

    expect(built.remediationAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment once policy allows marking ready", async () => {
    const store = makeStore(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    store.artifacts.push(
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      asArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({ overallVerdict: "approved" }),
      }),
    );
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe("run-1");
  });

  it("propagates the PolicyViolationError when checks are not satisfied", async () => {
    const store = makeStore(makeRun({ state: RunState.AIReview, prNumber: null }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("always returns to AwaitingPlanApproval even when the reviewer requests changes", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", title: "nit", details: "minor" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1", { note: "double check security" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check security" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("returns to AwaitingPlanApproval directly when the reviewer approves (no revision needed)", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision (with the operator note) when the reviewer requests changes", async () => {
    const store = makeStore(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "gap", details: "missing step" },
        ],
      }),
    );
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "pr-1",
        dispositions: [],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "focus on the gap" });

    // No PlanReview artifact was seeded, so the orchestrator passes `undefined`
    // through as the planReview argument (mirrors runPlanRevision's own
    // behavior reading back a missing artifact).
    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on the gap" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
  });
});

describe("OrchestratorService -- skill retrieval and metrics", () => {
  it("retrieveSkillsForPlanning (via retryRun) records a SKILL_INJECTION event when skills are injected", async () => {
    const store = makeStore(
      makeRun({
        state: RunState.Todo,
        branchName: "ai/run-1",
        linearIssueTitle: "Fix the deploy pipeline",
      }),
    );
    const built = buildDeps(store, { withAgentSkillRepo: true });
    built.setPlannerPlan(makePlan({ planVersion: 1 }));
    built.setPlanReviewerResult(makePlanReview());
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.agentSkillRepo?.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the deploy pipeline"),
      3,
    );
    const injectionEvents = store.events.filter((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvents).toHaveLength(1);
    expect((injectionEvents[0].payloadJson as { skillIds: string[] }).skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("updateSkillMetrics logs a warning and continues when incrementFailure throws for a skill", async () => {
    const store = makeStore(makeRun({ state: RunState.ReadyForHumanReview }));
    const built = buildDeps(store, { withAgentSkillRepo: true });
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });
    // approveHumanReview transitions to Done (HUMAN_APPROVED), which calls
    // updateSkillMetrics(runId, success=true) -> incrementSuccess for each
    // previously-injected skill. Make that call reject to exercise the
    // per-skill try/catch inside updateSkillMetrics.
    built.agentSkillRepo!.incrementSuccess.mockRejectedValue(new Error("db unavailable"));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const store = makeStore(makeRun({ state: RunState.ReadyForHumanReview }));
    const built = buildDeps(store, { withAgentSkillRepo: true });
    store.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(built.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.anything());
    expect(result.state).toBe(RunState.Done);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
    // Reaching Done triggers updateSkillMetrics, which should update the
    // skill that was injected during planning.
    expect(built.agentSkillRepo?.incrementSuccess).toHaveBeenCalledWith("skill-1");
  });

  it("ignores a distillation agent failure and still completes the run (best-effort)", async () => {
    const store = makeStore(makeRun({ state: RunState.ReadyForHumanReview }));
    const built = buildDeps(store);
    built.distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});
