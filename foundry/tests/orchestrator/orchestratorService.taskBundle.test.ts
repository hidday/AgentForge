import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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

function makePlan(): Plan {
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

/**
 * Minimal deps wiring for exercising buildTaskBundle() indirectly via
 * runPlanReview(), which calls it once and does not require the full
 * state-machine chain to complete (the plan-reviewer response just needs to
 * resolve so we can inspect the TaskBundle it received).
 */
function buildDeps(githubClientOverrides: Record<string, unknown>, repoRegistryOverrides: Record<string, unknown> = {}) {
  const plan = makePlan();
  const planArtifact = asArtifact({ type: "Plan", version: 1, payloadJson: plan });
  const run = makeRun();

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockResolvedValue({ ...run, state: RunState.AwaitingPlanApproval }),
    update: vi.fn().mockResolvedValue(run),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => (type === "Plan" ? Promise.resolve(planArtifact) : Promise.resolve(null))),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({ id: "LIN-1", title: "Test issue", description: "d", branchName: "ai/run-1", labels: [], priority: 0 }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main"), ...githubClientOverrides };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    ...repoRegistryOverrides,
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = { setupRunWorktree: vi.fn(), assertBranch: vi.fn(), commitAndPush: vi.fn(), removeWorktree: vi.fn(), resolveMainRepoPath: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    deps: {
      runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
      linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
      reviewerAgent, remediationAgent, logger, dashboardEmitter,
    },
    planReviewerAgent,
    logger,
  };
}

describe("OrchestratorService -- buildTaskBundle default-branch resolution", () => {
  it("keeps the configured defaultBranch (and logs no warning) when GitHub agrees", async () => {
    const { deps, planReviewerAgent, logger } = buildDeps({ getDefaultBranch: vi.fn().mockResolvedValue("main") });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const bundle = planReviewerAgent.run.mock.calls[0][1] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Config defaultBranch differs"),
    );
  });

  it("overrides the configured defaultBranch and warns when GitHub reports a different one", async () => {
    const { deps, planReviewerAgent, logger } = buildDeps({ getDefaultBranch: vi.fn().mockResolvedValue("trunk") });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const bundle = planReviewerAgent.run.mock.calls[0][1] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("trunk");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      expect.stringContaining("Config defaultBranch differs"),
    );
  });

  it("falls back to the configured defaultBranch and logs a warning when GitHub lookup throws", async () => {
    const { deps, planReviewerAgent, logger } = buildDeps({ getDefaultBranch: vi.fn().mockRejectedValue(new Error("GitHub down")) });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    const bundle = planReviewerAgent.run.mock.calls[0][1] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub down" }),
      expect.stringContaining("Failed to resolve default branch"),
    );
  });
});
