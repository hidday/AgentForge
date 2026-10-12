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
    state: RunState.PlanReview,
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
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [{ id: "q1", question: "Non-blocking?", requiredForExecution: false }],
    risks: ["Scope creep"],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(run: Run, extraArtifacts: Artifact[] = []) {
  let state = run.state;
  const artifacts: Artifact[] = [...extraArtifacts];

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state, ...patch })),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({ id: "LIN-1", title: "Test issue", description: "d", branchName: "ai/run-1", labels: [], priority: 0 }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    deps: {
      runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
      linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
      reviewerAgent, remediationAgent, logger, dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanReview -- changes_requested branch", () => {
  it("posts the plan-review comment and chains into runPlanRevision, ending in AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const extraArtifacts = [asArtifact({ type: "Plan", version: 1, payloadJson: plan })];
    const { deps, planReviewerAgent, planReviserAgent, linearClient, eventRepo, artifactRepo } = buildDeps(run, extraArtifacts);

    const planReview = {
      overallVerdict: "changes_requested" as const,
      summary: "Needs a revision",
      findings: [
        { id: "pf1", severity: "important" as const, title: "Missing step", affectedStepId: "s1", details: "Add detail" },
        { id: "pf2", severity: "minor" as const, title: "General concern", details: "Not tied to a specific step" },
      ],
    };
    // The real PlanReviewerAgent persists the PlanReview artifact itself before
    // returning; mimic that so runPlanRevision() can read it back.
    planReviewerAgent.run.mockImplementation(async () => {
      await artifactRepo.create({ runId: "run-1", type: "PlanReview", version: 1, payloadJson: planReview, rawText: "{}" });
      return planReview;
    });

    const revisedPlan = makePlan({ planVersion: 2, risks: [], openQuestions: [] });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "pf1", status: "accepted", rationale: "Makes sense" }] },
      revisedPlan,
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    const planReviewComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("AI Plan Review"));
    expect(planReviewComment).toContain("Changes Requested");
    expect(planReviewComment).toContain("Missing step");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      undefined,
    );

    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);

    const revisedComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Revised after AI review"));
    expect(revisedComment).toBeDefined();
    const dispositionComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Plan Revision Dispositions"));
    expect(dispositionComment).toContain("Makes sense");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("forwards an operator note to the plan reviser agent when provided", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview = { overallVerdict: "changes_requested" as const, summary: "x", findings: [] };
    const extraArtifacts = [
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
    ];
    const { deps, planReviserAgent } = buildDeps(run, extraArtifacts);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1", { note: "Trim scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "Trim scope" },
    );
  });
});
