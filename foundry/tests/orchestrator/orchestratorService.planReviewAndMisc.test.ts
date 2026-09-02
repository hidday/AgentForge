import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  makeRun,
  makePlan,
  makePlanReview,
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
  makePlanReviserAgentFake,
} from "./orchestratorTestHelpers.js";

function buildDeps(
  runOverrides: Partial<ReturnType<typeof makeRun>> = {},
  overrides: Record<string, unknown> = {},
) {
  const run = makeRun({ id: "run-1", state: RunState.PlanReview, ...runOverrides });
  const runRepo = makeRunRepoFake(run);
  const plan = makePlan({ planVersion: 1 });
  const artifactRepo = makeArtifactRepoFake({
    Plan: {
      id: "artifact-plan",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: plan,
      rawText: "{}",
      createdAt: new Date(),
    },
  });
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
  const planReviserAgent = makePlanReviserAgentFake(artifactRepo);
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
    planReviserAgent,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("moves an approved plan to AwaitingPlanApproval and posts the plan summary", async () => {
    const { deps, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runPlanReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Plan (v1)"),
    );
  });

  it("routes changes_requested verdicts into plan revision and lands on AwaitingPlanApproval with a revised plan", async () => {
    const { deps, runRepo, planReviserAgent } = buildDeps();
    deps.planReviewerAgent = makePlanReviewerAgentFake(deps.artifactRepo as never, () =>
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing edge case", details: "..." },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.getCurrent().planVersion).toBe(2);
  });

  it("throws when there is no plan artifact for the run", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.byType.delete("Plan");
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact/);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a worktree when the run has no branch yet, then advances to plan review", async () => {
    const { deps, gitService, runRepo } = buildDeps({ state: RunState.Todo, branchName: null });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.getCurrent().branchName).toBe("ai/lin-1-test");
  });

  it("does not re-create a worktree when the run already has a branch", async () => {
    const { deps, gitService } = buildDeps({ state: RunState.Todo, branchName: "ai/existing" });
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification without invoking plan review when the re-plan has blocking questions", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps({
      state: RunState.Todo,
      branchName: "ai/existing",
    });
    deps.plannerAgent = makePlannerAgentFake(artifactRepo, () =>
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.retryRun("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("throws Run not found for an unknown run id", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.retryRun("does-not-exist")).rejects.toThrow("Run not found: does-not-exist");
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps } = buildDeps({ state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const { deps } = buildDeps({ state: RunState.AwaitingPlanApproval });
    deps.planReviewerAgent = makePlanReviewerAgentFake(deps.artifactRepo as never, () =>
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays at AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const { deps, planReviserAgent } = buildDeps({ state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("revises the plan and returns to AwaitingPlanApproval when the reviewer requests changes", async () => {
    const { deps, planReviserAgent, runRepo } = buildDeps({ state: RunState.AwaitingPlanApproval });
    deps.planReviewerAgent = makePlanReviewerAgentFake(deps.artifactRepo as never, () =>
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.getCurrent().planVersion).toBe(2);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions the run to Done, cleans up the worktree, and posts a completion comment", async () => {
    const { deps, gitService, linearClient } = buildDeps({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/worktree",
    });
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
  });

  it("does not clean up the worktree when the run's working directory IS the main repo path", async () => {
    const { deps, gitService } = buildDeps({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/main-repo",
    });
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("swallows a distillation agent failure and still completes the run", async () => {
    const { deps } = buildDeps({ state: RunState.ReadyForHumanReview });
    const logger = deps.logger as ReturnType<typeof import("./orchestratorTestHelpers.js").makeLoggerFake>;
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };
    (deps as Record<string, unknown>).distillationAgent = distillationAgent;
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });

  it("updates skill success metrics for skills that were injected during planning", async () => {
    const { deps } = buildDeps({ state: RunState.ReadyForHumanReview });
    const skill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
      utilityScore: 0.5,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skill]),
      incrementSuccess: vi.fn().mockResolvedValue(skill),
      incrementFailure: vi.fn().mockResolvedValue(skill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    (deps as Record<string, unknown>).agentSkillRepo = agentSkillRepo;
    const eventRepo = deps.eventRepo as ReturnType<typeof import("./orchestratorTestHelpers.js").makeEventRepoFake>;
    eventRepo.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(skill);
  });

  it("logs and continues when updating a skill metric fails", async () => {
    const { deps } = buildDeps({ state: RunState.ReadyForHumanReview });
    const logger = deps.logger as ReturnType<typeof import("./orchestratorTestHelpers.js").makeLoggerFake>;
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    (deps as Record<string, unknown>).agentSkillRepo = agentSkillRepo;
    const eventRepo = deps.eventRepo as ReturnType<typeof import("./orchestratorTestHelpers.js").makeEventRepoFake>;
    eventRepo.events.push({
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-err"] },
      createdAt: new Date(),
    });

    const svc = new OrchestratorService(deps as never);
    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-err" }),
      expect.stringContaining("Failed to update skill metric"),
    );
  });
});

describe("OrchestratorService requireRun failures", () => {
  it("throws 'Run not found' from runPlanReview when the run does not exist", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws 'Run not found' from approveHumanReview when the run does not exist", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approveHumanReview("missing-run")).rejects.toThrow(
      "Run not found: missing-run",
    );
  });
});
