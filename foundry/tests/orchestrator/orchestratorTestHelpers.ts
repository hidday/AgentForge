import { vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { transition } from "../../src/orchestrator/stateMachine.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { RunEvent } from "../../src/domain/runEvent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

/**
 * Builds a stateful in-memory RunRepository fake: `updateState`/`update`
 * mutate an internal `Run` record using the real `transition()` function
 * (rather than pre-scripted `mockResolvedValueOnce` chains), so it stays
 * correct across arbitrarily long multi-step orchestration flows.
 */
export function makeRunRepoFake(initialRun: Run) {
  let current: Run = { ...initialRun };
  const create = vi.fn(async (data: Partial<Run> & { linearIssueId: string; repo: string }) => {
    current = {
      ...current,
      ...data,
      state: RunState.Todo,
    };
    return { ...current };
  });
  return {
    findById: vi.fn(async (id: string) => (id === current.id ? { ...current } : null)),
    findActiveByIssueId: vi.fn(async () => null),
    findAll: vi.fn(async () => [current]),
    create,
    findByIssueId: vi.fn(async () => [current]),
    updateState: vi.fn(async (_id: string, newState: RunState) => {
      current = { ...current, state: newState };
      return { ...current };
    }),
    update: vi.fn(async (_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return { ...current };
    }),
    getCurrent: () => current,
  };
}

/** In-memory ArtifactRepository fake keyed by artifact type (latest wins). */
export function makeArtifactRepoFake(seed: Partial<Record<ArtifactType, Artifact>> = {}) {
  const byType = new Map<ArtifactType, Artifact>(
    Object.entries(seed) as [ArtifactType, Artifact][],
  );
  let counter = 0;
  const create = vi.fn(
    async (data: { runId: string; type: ArtifactType; version: number; payloadJson: unknown; rawText?: string }) => {
      const artifact: Artifact = {
        id: `artifact-${++counter}`,
        runId: data.runId,
        type: data.type,
        version: data.version,
        payloadJson: data.payloadJson,
        rawText: data.rawText ?? "{}",
        createdAt: new Date(),
      };
      byType.set(data.type, artifact);
      return artifact;
    },
  );
  const findLatestByType = vi.fn(async (_runId: string, type: ArtifactType) => byType.get(type) ?? null);
  const findByRunId = vi.fn(async () => Array.from(byType.values()));
  return { create, findLatestByType, findByRunId, byType };
}

/** In-memory EventRepository fake that records every event created. */
export function makeEventRepoFake() {
  const events: RunEventRecord[] = [];
  let counter = 0;
  const create = vi.fn(
    async (data: { runId: string; eventType: RunEvent | string; source: string; payloadJson?: unknown }) => {
      const record: RunEventRecord = {
        id: `event-${++counter}`,
        runId: data.runId,
        eventType: data.eventType,
        source: data.source,
        payloadJson: data.payloadJson ?? {},
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  );
  const findByRunId = vi.fn(async () => [...events]);
  return { create, findByRunId, events };
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "A description",
    linearIssueTitle: "A title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "test-repo",
    branchName: "ai/lin-1-test",
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

export function makePlan(overrides: Partial<Plan> = {}): Plan {
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

export function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
      repoPath: "/tmp/worktree",
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

export function makeRepoRegistryFake() {
  return {
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main-repo"),
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
}

export function makeLoggerFake() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

export function makeGitServiceFake() {
  return {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/lin-1-test" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
  };
}

export function makeLinearClientFake() {
  return {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1-test",
      labels: [],
      priority: 0,
      project: "test-project",
      url: "https://linear.app/issue/LIN-1",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
}

export function makeGithubClientFake() {
  return {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/x b/x"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };
}

export function makeGithubSyncFake() {
  return {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
  };
}

export function makeLinearSyncFake() {
  return { syncState: vi.fn().mockResolvedValue(undefined) };
}

export function makeDashboardEmitterFake() {
  return {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid implementation",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-review-1",
    summary: "Plan looks solid",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

type ArtifactRepoFake = ReturnType<typeof makeArtifactRepoFake>;

/** Fake PlannerAgent: persists a "Plan" artifact, mirroring the real agent. */
export function makePlannerAgentFake(
  artifactRepo: ArtifactRepoFake,
  planFactory: (opts: { planVersionOverride?: number }) => Plan = (opts) =>
    makePlan({ planVersion: opts.planVersionOverride ?? 1 }),
) {
  const run = vi.fn(
    async (
      _bundle: TaskBundle,
      runId: string,
      opts: { planVersionOverride?: number } = {},
    ): Promise<Plan> => {
      const plan = planFactory(opts);
      await artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    },
  );
  return { run };
}

/** Fake PlanReviewerAgent: persists a "PlanReview" artifact. */
export function makePlanReviewerAgentFake(
  artifactRepo: ArtifactRepoFake,
  reviewFactory: () => PlanReview = () => makePlanReview(),
) {
  const run = vi.fn(async (_plan: Plan, _bundle: TaskBundle, runId: string): Promise<PlanReview> => {
    const review = reviewFactory();
    await artifactRepo.create({
      runId,
      type: "PlanReview",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review),
    });
    return review;
  });
  return { run };
}

/** Fake PlanReviserAgent: persists a revised "Plan" artifact. */
export function makePlanReviserAgentFake(
  artifactRepo: ArtifactRepoFake,
  reviseFactory: (plan: Plan) => Plan = (plan) => makePlan({ planVersion: plan.planVersion + 1 }),
) {
  const run = vi.fn(
    async (
      plan: Plan,
      _planReview: PlanReview,
      _bundle: TaskBundle,
      runId: string,
    ): Promise<{
      revision: { dispositions: { findingId: string; status: string; rationale: string }[] };
      revisedPlan: Plan;
    }> => {
      const revisedPlan = reviseFactory(plan);
      await artifactRepo.create({
        runId,
        type: "Plan",
        version: revisedPlan.planVersion,
        payloadJson: revisedPlan,
        rawText: JSON.stringify(revisedPlan),
      });
      return { revision: { dispositions: [] }, revisedPlan };
    },
  );
  return { run };
}

/** Fake ExecutorAgent: persists an "ExecutionReport" artifact. */
export function makeExecutorAgentFake(
  artifactRepo: ArtifactRepoFake,
  reportFactory: () => ExecutionReport = () => makeExecutionReport(),
  prNumber = 42,
) {
  const run = vi.fn(
    async (
      _plan: Plan,
      _bundle: TaskBundle,
      runId: string,
    ): Promise<{ report: ExecutionReport; prNumber: number }> => {
      const report = reportFactory();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber };
    },
  );
  return { run };
}

/** Fake ReviewerAgent: persists a "Review" artifact. */
export function makeReviewerAgentFake(
  artifactRepo: ArtifactRepoFake,
  reviewFactory: () => Review = () => makeReview(),
) {
  const run = vi.fn(
    async (
      _plan: Plan,
      _executionReport: ExecutionReport,
      _diff: string,
      _bundle: TaskBundle,
      runId: string,
    ): Promise<Review> => {
      const review = reviewFactory();
      await artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    },
  );
  return { run };
}

/** Fake RemediationAgent: persists an updated "ExecutionReport" + "Remediation" artifact. */
export function makeRemediationAgentFake(
  artifactRepo: ArtifactRepoFake,
  resultFactory: () => {
    executionReport: ExecutionReport;
    resolution: { findingId: string; status: string; action: string; rationale: string }[];
  } = () => ({
    executionReport: makeExecutionReport({ executionVersion: 2 }),
    resolution: [],
  }),
) {
  const run = vi.fn(
    async (
      _review: Review,
      _executionReport: ExecutionReport,
      _workingDirectory: string,
      runId: string,
    ) => {
      const result = resultFactory();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: result.executionReport.executionVersion,
        payloadJson: result.executionReport,
        rawText: JSON.stringify(result.executionReport),
      });
      await artifactRepo.create({
        runId,
        type: "Remediation",
        version: 1,
        payloadJson: result,
        rawText: JSON.stringify(result),
      });
      return result;
    },
  );
  return { run };
}

export { transition };
