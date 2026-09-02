import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  makeRun,
  makePlan,
  makeRunRepoFake,
  makeArtifactRepoFake,
  makeEventRepoFake,
  makeRepoRegistryFake,
  makeLoggerFake,
  makeGitServiceFake,
  makeLinearClientFake,
  makeGithubClientFake,
  makeGithubSyncFake,
  makeLinearSyncFake,
  makeDashboardEmitterFake,
  makePlannerAgentFake,
  makePlanReviewerAgentFake,
} from "./orchestratorTestHelpers.js";

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = makeRunRepoFake(makeRun({ id: "run-1", state: RunState.Todo }));
  const artifactRepo = makeArtifactRepoFake();
  const eventRepo = makeEventRepoFake();
  const linearClient = makeLinearClientFake();
  const githubClient = makeGithubClientFake();
  const gitService = makeGitServiceFake();
  const repoRegistry = makeRepoRegistryFake();
  const linearSync = makeLinearSyncFake();
  const githubSync = makeGithubSyncFake();
  const dashboardEmitter = makeDashboardEmitterFake();
  const logger = makeLoggerFake();

  const plannerAgent = makePlannerAgentFake(artifactRepo);
  const planReviewerAgent = makePlanReviewerAgentFake(artifactRepo);
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    repoRegistry,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one when one already exists", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    (deps.runRepo as { findActiveByIssueId: ReturnType<typeof vi.fn> }).findActiveByIssueId =
      vi.fn().mockResolvedValue(makeRun({ id: "run-existing", state: RunState.Planning }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.startRun("LIN-1");

    expect(run.id).toBe("run-existing");
    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("creates a run, sets up a worktree, and advances straight to plan review when there are no blocking questions", async () => {
    const { deps, runRepo, gitService, dashboardEmitter, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = await svc.startRun("LIN-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1-test",
    );
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(planReviewerAgent.run).toHaveBeenCalled();
    // PLAN_REVIEW_APPROVED -> AwaitingPlanApproval
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.getCurrent().planVersion).toBe(1);
  });

  it("pauses for human clarification and does not run plan review when the plan has blocking open questions", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps();
    deps.plannerAgent = makePlannerAgentFake(artifactRepo, () =>
      makePlan({
        planVersion: 1,
        openQuestions: [
          { id: "q1", question: "Which auth provider?", requiredForExecution: true },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.startRun("LIN-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("persists a TaskBundle artifact exactly once during the run", async () => {
    const { deps, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const taskBundleCalls = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCalls).toHaveLength(1);
  });
});
