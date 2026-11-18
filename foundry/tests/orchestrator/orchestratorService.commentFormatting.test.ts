import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

// These tests target the Linear comment-formatting helpers
// (formatExecutionReportComment / formatPlanReviewComment) in orchestratorService.ts,
// specifically the edge-case branches that the main integration test files don't
// exercise: zero files changed, a large (collapsed) file list, non-empty notes,
// and plan-review findings with/without an affectedStepId.

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
    state: RunState.AddressingReview,
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found one bug",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "Real issue",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation summary.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all tests pass" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
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

/** Minimal deps shared by both describe blocks below. */
function buildBaseDeps(initialRun: Run, artifacts: Artifact[]) {
  // Tracks the run's current state across transitionAndRecord() calls so that
  // a later requireRun() (e.g. inside runPlanRevision, called from within
  // runPlanReview) sees the up-to-date state rather than the original fixture.
  const store = { state: initialRun.state };

  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.state }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.state = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.state }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue(artifacts),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
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
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockRejectedValue(new Error("not available in test")),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockRejectedValue(new Error("not available in test")),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const gitService = {
    setupRunWorktree: vi.fn(),
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
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService -- formatExecutionReportComment branches (via runRemediation)", () => {
  function buildDepsForRemediation(executionReportOverrides: Partial<ExecutionReport>) {
    const initialRun = makeRun({ state: RunState.AddressingReview });
    const artifacts = [
      asArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ];
    const base = buildBaseDeps(initialRun, artifacts);

    const newReport = makeExecutionReport({
      executionVersion: 2,
      ...executionReportOverrides,
    });

    const remediationAgent = {
      run: vi.fn().mockResolvedValue({
        reviewId: "rev-001",
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed bug", rationale: "Real bug" },
        ],
        readyForHumanReview: true,
        executionReport: newReport,
      }),
    };

    const plannerAgent = { run: vi.fn() };
    const planReviewerAgent = { run: vi.fn() };
    const planReviserAgent = { run: vi.fn() };
    const executorAgent = { run: vi.fn() };
    const reviewerAgent = { run: vi.fn() };

    const deps = {
      ...base,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
    };

    return { deps, linearClient: base.linearClient, newReport };
  }

  async function runRemediationAndCapturePostedComment(
    executionReportOverrides: Partial<ExecutionReport>,
  ): Promise<string> {
    const { deps, linearClient } = buildDepsForRemediation(executionReportOverrides);
    const svc = new OrchestratorService(deps as never);

    // markReady throws on the verdict check afterward (pre-existing, out of
    // scope here); we only care about the comment posted before that point.
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
    }

    const postCalls = linearClient.postComment.mock.calls as unknown[][];
    // First postComment call is the ExecutionReport comment.
    const commentText = postCalls[0]?.[1] as string;
    expect(typeof commentText).toBe("string");
    return commentText;
  }

  it("omits the Files changed section entirely when filesChanged is empty", async () => {
    const comment = await runRemediationAndCapturePostedComment({ filesChanged: [] });
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("<details>");
  });

  it("lists files inline (no <details> collapse) when filesChanged is small (<= 8)", async () => {
    const comment = await runRemediationAndCapturePostedComment({
      filesChanged: ["src/a.ts", "src/b.ts"],
    });
    expect(comment).toContain("### Files changed (2)");
    expect(comment).not.toContain("<details>");
    expect(comment).toContain("`src/a.ts`");
    expect(comment).toContain("`src/b.ts`");
  });

  it("collapses the file list inside a <details> block when filesChanged exceeds 8", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const comment = await runRemediationAndCapturePostedComment({ filesChanged: manyFiles });
    expect(comment).toContain("<details>");
    expect(comment).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(comment).toContain("</details>");
    expect(comment).toContain("`src/file0.ts`");
    expect(comment).toContain("`src/file8.ts`");
  });

  it("omits the Notes section when notes is empty", async () => {
    const comment = await runRemediationAndCapturePostedComment({ notes: [] });
    expect(comment).not.toContain("### Notes");
  });

  it("includes a Notes section listing each note when notes is non-empty", async () => {
    const comment = await runRemediationAndCapturePostedComment({
      notes: ["Skipped the boundary test case.", "Left a TODO for follow-up."],
    });
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Skipped the boundary test case.");
    expect(comment).toContain("Left a TODO for follow-up.");
  });
});

describe("OrchestratorService -- formatPlanReviewComment branches (via runPlanReview)", () => {
  function buildDepsForPlanReview(planReview: PlanReview) {
    const initialRun = makeRun({ state: RunState.PlanReview, branchName: null, prNumber: null });
    const plan: Plan = {
      planVersion: 1,
      summary: "Test plan",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
      testPlan: "Run tests",
      confidence: 0.9,
    };
    const artifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: plan })];
    const base = buildBaseDeps(initialRun, artifacts);

    const plannerAgent = { run: vi.fn() };
    const planReviewerAgent = { run: vi.fn().mockResolvedValue(planReview) };
    // runPlanReview falls through into runPlanRevision when changes_requested;
    // give the reviser agent a minimal, well-formed response so that call
    // also completes without throwing.
    const planReviserAgent = {
      run: vi.fn().mockResolvedValue({
        revision: {
          originalPlanVersion: 1,
          revisedPlanVersion: 2,
          reviewId: planReview.reviewId,
          dispositions: planReview.findings.map((f) => ({
            findingId: f.id,
            status: "accepted" as const,
            rationale: "Addressed in revision.",
          })),
        },
        revisedPlan: { ...plan, planVersion: 2 },
      }),
    };
    const executorAgent = { run: vi.fn() };
    const reviewerAgent = { run: vi.fn() };
    const remediationAgent = { run: vi.fn() };

    const deps = {
      ...base,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
    };

    return { deps, linearClient: base.linearClient };
  }

  it("renders a finding's affectedStepId as '(step <id>)' when present", async () => {
    const planReview: PlanReview = {
      reviewId: "plan-rev-1",
      summary: "One concern about step s1.",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "design",
          affectedStepId: "s1",
          title: "Step is underspecified",
          details: "Needs more detail on error handling.",
        },
      ],
    };
    const { deps, linearClient } = buildDepsForPlanReview(planReview);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const postCalls = linearClient.postComment.mock.calls as unknown[][];
    const reviewComment = postCalls.find(
      (c) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    )?.[1] as string;

    expect(reviewComment).toBeDefined();
    expect(reviewComment).toContain("Changes Requested");
    expect(reviewComment).toContain("[IMPORTANT]");
    expect(reviewComment).toContain("Step is underspecified");
    expect(reviewComment).toContain("(step s1)");
    expect(reviewComment).toContain("Needs more detail on error handling.");
  });

  it("omits the '(step ...)' suffix when a finding has no affectedStepId", async () => {
    const planReview: PlanReview = {
      reviewId: "plan-rev-2",
      summary: "General concerns.",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          type: "style",
          title: "Consider renaming the helper",
          details: "Not blocking, just a naming nit.",
        },
      ],
    };
    const { deps, linearClient } = buildDepsForPlanReview(planReview);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const postCalls = linearClient.postComment.mock.calls as unknown[][];
    const reviewComment = postCalls.find(
      (c) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    )?.[1] as string;

    expect(reviewComment).toBeDefined();
    expect(reviewComment).toContain("Consider renaming the helper");
    expect(reviewComment).not.toContain("(step ");
  });

  it("also posts a Plan Revision Dispositions comment (formatPlanRevisionComment) after the review comment", async () => {
    const planReview: PlanReview = {
      reviewId: "plan-rev-3",
      summary: "Needs one change.",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          title: "Blocking issue",
          details: "Must fix before proceeding.",
        },
      ],
    };
    const { deps, linearClient } = buildDepsForPlanReview(planReview);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const postCalls = linearClient.postComment.mock.calls as unknown[][];
    const dispositionComment = postCalls.find(
      (c) =>
        typeof c[1] === "string" && (c[1] as string).includes("Plan Revision Dispositions"),
    )?.[1] as string;

    expect(dispositionComment).toBeDefined();
    expect(dispositionComment).toContain("**f1** [accepted]: Addressed in revision.");
  });
});
