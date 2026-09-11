import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn(),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };

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
      agentSkillRepo,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    agentSkillRepo,
  };
}

describe("OrchestratorService -- dependency accessors", () => {
  it("exposes the injected repositories and Linear client unchanged", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when the dependency was never supplied", () => {
    const { deps } = buildDeps();
    const depsWithoutSkillRepo = { ...deps, agentSkillRepo: undefined };
    const svc = new OrchestratorService(depsWithoutSkillRepo as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command payloads to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "run-ai" },
    });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("does nothing for comment.command payloads missing a command", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(startRunSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  function svcWithStartRunSpy() {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    return { ...built, svc };
  }

  it("ai-plan calls startRun", async () => {
    const { svc } = svcWithStartRunSpy();
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai calls startRun", async () => {
    const { svc } = svcWithStartRunSpy();
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan looks up the active run, then approves and executes it", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan is a no-op when there is no active run for the issue", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan looks up the active run and rejects it with the command body", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs work", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review looks up the active run and triggers a re-review", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run to AIBlocked via BLOCKED", async () => {
    const { svc, runRepo, eventRepo } = svcWithStartRunSpy();
    const activeRun = makeRun({ id: "run-42", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.AIBlocked }));

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.BLOCKED);
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run back to Todo via RESET_TO_TODO", async () => {
    const { svc, runRepo, eventRepo } = svcWithStartRunSpy();
    const activeRun = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.Todo }));

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithStartRunSpy();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const { svc, runRepo, deps } = svcWithStartRunSpy();
    const logger = deps.logger;

    const unknownCommand: LinearCommand = { type: "unknown", raw: "/bogus" };
    await svc.handleCommand("LIN-1", unknownCommand);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Unknown command"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.startRun -- active run short-circuit", () => {
  it("returns the existing active run without creating a new one when one is already active for the issue", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const existingRun = makeRun({ id: "run-existing", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(existingRun);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existingRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});
