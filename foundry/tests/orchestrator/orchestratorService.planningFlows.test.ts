import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    state: RunState.Planning,
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
    openQuestions: [],
    risks: [],
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

function buildDeps(initialRun: Run, extraArtifacts: Artifact[] = []) {
  const artifacts: Artifact[] = [...extraArtifacts];
  let runState = initialRun.state;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...initialRun, state: runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...initialRun, state: runState, ...patch }),
    ),
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
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1", title: "Test issue", description: "Test description", branchName: "ai/run-1", labels: [], priority: 0,
    }),
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
  // The real PlannerAgent persists the Plan artifact itself before returning;
  // mimic that so downstream runPlanReview() can find it via findLatestByType.
  const plannerAgent = {
    run: vi.fn().mockImplementation(async (_bundle: unknown, runId: string) => {
      const plan = makePlan();
      await artifactRepo.create({ runId, type: "Plan", version: plan.planVersion, payloadJson: plan, rawText: "{}" });
      return plan;
    }),
  };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/new-worktree", branchName: "ai/run-1-fresh" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
    gitService,
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with the next plan version, injecting previousPlan/rejectionContext/humanAnswers/researchedAnswers/planReviewFindings, and proceeds to plan review when no blockers remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const previousPlan = makePlan({ planVersion: 2, risks: ["Some risk"] });
    const extraArtifacts = [
      asArtifact({ type: "RejectionContext", version: 2, payloadJson: { planVersion: 2, feedback: "Use OAuth2", source: "api", mode: "iterate" } }),
      asArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }),
      asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
      asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: { summary: "s", answers: [{ questionId: "q2", question: "Q?", answer: "A", confidence: "high" }], completedAt: "2026-01-01T00:00:00Z" } }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "Needs work", findings: [{ id: "pf1", severity: "important", title: "X", details: "Y" }] } }),
    ];
    const { deps, runRepo, plannerAgent, planReviewerAgent, artifactRepo } = buildDeps(run, extraArtifacts);
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockImplementation(async (_b: unknown, runId: string) => {
      await artifactRepo.create({ runId, type: "Plan", version: newPlan.planVersion, payloadJson: newPlan, rawText: "{}" });
      return newPlan;
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q?", answer: "A", confidence: "high" }],
        planReviewFindings: { summary: "Needs work", findings: [{ id: "pf1", severity: "important", title: "X", details: "Y" }] },
      }),
    );

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3, plannerRuntime: "claude-code" });
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent, artifactRepo } = buildDeps(run);
    const blockingPlan = makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }] });
    plannerAgent.run.mockImplementation(async (_b: unknown, runId: string) => {
      await artifactRepo.create({ runId, type: "Plan", version: blockingPlan.planVersion, payloadJson: blockingPlan, rawText: "{}" });
      return blockingPlan;
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("reuses the existing branch/worktree when the run already has one, and proceeds through plan review", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", workingDirectory: "/tmp/worktree" });
    const { deps, gitService, runRepo, plannerAgent, planReviewerAgent, artifactRepo } = buildDeps(run);
    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockImplementation(async (_b: unknown, runId: string) => {
      await artifactRepo.create({ runId, type: "Plan", version: plan.planVersion, payloadJson: plan, rawText: "{}" });
      return plan;
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(runRepo.update).not.toHaveBeenCalledWith("run-1", expect.objectContaining({ workingDirectory: expect.anything(), branchName: expect.anything() }));
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("sets up a new worktree/branch when the run has none yet", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null });
    const { deps, gitService, runRepo, plannerAgent, artifactRepo } = buildDeps(run);
    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockImplementation(async (_b: unknown, runId: string) => {
      await artifactRepo.create({ runId, type: "Plan", version: plan.planVersion, payloadJson: plan, rawText: "{}" });
      return plan;
    });
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/run-1",
    );
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ workingDirectory: "/tmp/new-worktree", branchName: "ai/run-1-fresh" }),
    );
  });

  it("pauses for human clarification when the fresh plan has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(run);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 1, openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
