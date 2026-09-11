import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
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
// Stateful harness (duplicated per-file by convention).
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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
    executorAgent,
    reviewerAgent,
    distillationAgent,
    gitService,
    agentSkillRepo,
    logger,
  };
}

function queuePlannerPlan(h: { plannerAgent: { run: ReturnType<typeof vi.fn> }; store: Store }, plan: Plan) {
  h.plannerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "Plan", plan.planVersion, plan));
    return plan;
  });
}

function queueExecutorResult(
  h: { executorAgent: { run: ReturnType<typeof vi.fn> }; store: Store },
  report: ExecutionReport,
  prNumber: number,
) {
  h.executorAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "ExecutionReport", report.executionVersion, report));
    return { report, prNumber };
  });
}

function queueReviewerResult(
  h: { reviewerAgent: { run: ReturnType<typeof vi.fn> }; store: Store },
  review: Review,
) {
  h.reviewerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "Review", 1, review));
    return review;
  });
}

// ---------------------------------------------------------------------------
// requireRun: "Run not found" guard, shared by nearly every public method
// ---------------------------------------------------------------------------

describe("OrchestratorService -- requireRun guard", () => {
  it("throws a plain Error identifying the missing run id when the run does not exist", async () => {
    const h = buildHarness(makeRun());
    h.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

// ---------------------------------------------------------------------------
// retryRun: repo registry fallback + skill query null-safety
// ---------------------------------------------------------------------------

describe("OrchestratorService.retryRun -- repo resolution and skill query fallbacks", () => {
  it("falls back to the default repo entry when getRepoByName returns nothing", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: null, repo: "unknown-repo" });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.repoRegistry.getRepoByName.mockReturnValue(undefined);

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun("run-1");

    expect(h.repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/worktree",
      "run-1",
      REPO_ENTRY.defaultBranch,
      expect.any(String),
    );
  });

  it("safely builds the skill-relevance query when the run has no title or description", async () => {
    const initialRun = makeRun({
      state: RunState.Todo,
      branchName: "ai/existing",
      linearIssueTitle: null,
      linearIssueDescription: null,
    });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-x",
        repoSlug: "test-repo",
        name: null,
        description: null,
        taskCategory: "cat",
        skillMarkdown: "# md",
        utilityScore: 1,
        lastUsedAt: new Date(),
      },
    ]);
    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.retryRun("run-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", 3);
  });
});

// ---------------------------------------------------------------------------
// formatPlanComment: risks section rendered when the plan has risks
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanReview -- plan comment renders risks", () => {
  it("includes a Risks section in the approval comment when the plan lists risks", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(
      makeArtifact(h.store, "Plan", 1, makePlan({ risks: ["Might break prod", "Needs migration"] })),
    );
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runPlanReview("run-1");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan"),
    )?.[1] as string;
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Might break prod");
    expect(comment).toContain("Needs migration");
  });
});

// ---------------------------------------------------------------------------
// formatExecutionReportComment: fail/skip check icons
// ---------------------------------------------------------------------------

describe("OrchestratorService.runExecution -- execution report check icons", () => {
  it("renders the fail and skip icons for non-passing checks", async () => {
    const initialRun = makeRun({ state: RunState.Implementing });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "2 errors" },
        typecheck: { status: "skip", details: "not run" },
        tests: { status: "pass", details: "ok" },
      },
    });
    queueExecutorResult(h, report, 10);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    // The execution-report comment is posted before the cascade into
    // runReview()/markReady(); markReady then legitimately rejects because
    // this report has failing checks (a genuine, unrelated policy guard) --
    // that rejection is expected and orthogonal to what this test verifies.
    await expect(svc.runExecution("run-1")).rejects.toThrow(/failing checks/);

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain(":x:");
    expect(comment).toContain(":heavy_minus_sign:");
    expect(comment).toContain(":white_check_mark:");
  });
});

// ---------------------------------------------------------------------------
// formatPlanReviewComment / formatCodeReviewComment: optional field rendering
// ---------------------------------------------------------------------------

describe("OrchestratorService -- optional finding fields render when present", () => {
  it("includes the affected step id in a plan review finding when set", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "changes needed",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing validation",
          details: "add it",
        },
      ],
    });
    h.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanReview("run-1");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan Review"),
    )?.[1] as string;
    expect(comment).toContain("(step s1)");
  });

  it("includes the line hint in a code review finding when set", async () => {
    const initialRun = makeRun({ state: RunState.AIReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan()));
    h.store.artifacts.push(makeArtifact(h.store, "ExecutionReport", 1, makeExecutionReport()));

    queueReviewerResult(
      h,
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            lineHint: 42,
            title: "Off by one",
            details: "fix the loop bound",
          },
        ],
      }),
    );
    h.deps.remediationAgent.run.mockImplementation(async () => {
      const newReport = makeExecutionReport({ executionVersion: 2 });
      h.store.artifacts.push(makeArtifact(h.store, "ExecutionReport", 2, newReport));
      h.store.artifacts.push(
        makeArtifact(h.store, "Review", 2, makeReview({ overallVerdict: "approved" })),
      );
      return {
        reviewId: "rev-1",
        resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "ok" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    await svc.runReview("run-1");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    )?.[1] as string;
    expect(comment).toContain("src/a.ts:42");
  });
});

// ---------------------------------------------------------------------------
// buildTaskBundle: non-Error rejections are stringified, not crashed on
// ---------------------------------------------------------------------------

describe("OrchestratorService.buildTaskBundle -- non-Error rejection handling", () => {
  it("stringifies a non-Error thrown by githubClient.getDefaultBranch", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.githubClient.getDefaultBranch.mockRejectedValue("rate limited");

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runPlanning("run-1");

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("rate limited");
  });

  it("stringifies a non-Error thrown by linearClient.getRelatedContext", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.linearClient.getRelatedContext.mockRejectedValue("service unavailable");

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runPlanning("run-1");

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to fetch related Linear context"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("service unavailable");
  });
});

// ---------------------------------------------------------------------------
// answerQuestions: prior ResearchedAnswers threaded into the re-plan call
// ---------------------------------------------------------------------------

describe("OrchestratorService.answerQuestions -- prior researched answers are preserved", () => {
  it("forwards a non-empty prior ResearchedAnswers artifact into the humanAnswers re-plan call", async () => {
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
    h.store.artifacts.push(
      makeArtifact(h.store, "ResearchedAnswers", 1, {
        summary: "s",
        answers: [{ questionId: "q0", question: "Q0?", answer: "prior", confidence: "low" }],
        completedAt: "2026-01-01T00:00:00Z",
      }),
    );

    queuePlannerPlan(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "OK",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(h.plannerAgent.run.mock.calls[0]?.[2]).toMatchObject({
      researchedAnswers: [expect.objectContaining({ questionId: "q0", confidence: "low" })],
    });
  });
});

// ---------------------------------------------------------------------------
// runManualPlanRevision: changes_requested branch without an operator note
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualPlanRevision -- changes_requested without an operator note", () => {
  it("revises the plan without an operatorNote when opts.note is not supplied", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    h.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "changes needed",
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "T", details: "D" }],
    });
    h.deps.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runManualPlanRevision("run-1");

    // The 2nd positional arg (planReview) is undefined here because no
    // PlanReview artifact was persisted in this harness -- consistent with
    // the fact that OrchestratorService never writes that artifact itself
    // (the real PlanReviewerAgent would). What this test actually verifies
    // is the final `opts` argument: undefined, not `{ operatorNote: ... }`,
    // confirming the no-note branch was taken.
    expect(h.deps.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// approveHumanReview: non-Error rejection from the distillation agent
// ---------------------------------------------------------------------------

describe("OrchestratorService.approveHumanReview -- non-Error distillation rejection", () => {
  it("stringifies a non-Error rejection from the distillation agent", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.distillationAgent.run.mockRejectedValue("distillation service down");

    await svc.approveHumanReview("run-1");

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation service down");
  });
});

// ---------------------------------------------------------------------------
// updateSkillMetrics: missing skillIds field + non-Error thrown in the loop
// ---------------------------------------------------------------------------

describe("OrchestratorService -- updateSkillMetrics edge cases", () => {
  it("treats a SKILL_INJECTION event with no skillIds field as contributing no ids", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.events.push({
      id: "e-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(),
    });

    await svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown while updating a skill's metrics", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.events.push({
      id: "e-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-z"] },
      createdAt: new Date(),
    });
    h.agentSkillRepo.incrementSuccess.mockRejectedValue("metrics store unreachable");

    await svc.approveHumanReview("run-1");

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("metrics store unreachable");
  });
});

// ---------------------------------------------------------------------------
// runPlanRevision: an existing PlanReview artifact is threaded to the reviser
// ---------------------------------------------------------------------------

describe("OrchestratorService.runPlanRevision -- existing PlanReview artifact", () => {
  it("passes the persisted PlanReview payload (not undefined) to the plan reviser", async () => {
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    const persistedReview = {
      reviewId: "pr-1",
      summary: "changes needed",
      overallVerdict: "changes_requested" as const,
      findings: [{ id: "f1", severity: "nit" as const, type: "style", title: "T", details: "D" }],
    };
    h.store.artifacts.push(makeArtifact(h.store, "PlanReview", 1, persistedReview));
    h.deps.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1");

    expect(h.deps.planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      persistedReview,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// runExecution: operator note forwarded to the executor agent
// ---------------------------------------------------------------------------

describe("OrchestratorService.runExecution -- operator note forwarded to the executor", () => {
  it("passes { operatorNote } to the executor agent when opts.note is supplied", async () => {
    const initialRun = makeRun({ state: RunState.Implementing });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));
    queueExecutorResult(h, makeExecutionReport(), 11);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1", { note: "focus on the auth module" });

    expect(h.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: "ai/run-1" }),
      { operatorNote: "focus on the auth module" },
    );
  });
});
