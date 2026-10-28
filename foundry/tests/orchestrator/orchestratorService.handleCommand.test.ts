import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

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

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function buildService(runRepoOverrides: Record<string, unknown> = {}) {
  const runRepo = {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    ...runRepoOverrides,
  };

  const svc = new OrchestratorService({
    runRepo,
    artifactRepo: {},
    eventRepo: {},
    linearClient: {},
    githubClient: {},
    gitService: {},
    repoRegistry: {},
    linearSync: {},
    githubSync: {},
    plannerAgent: {},
    planReviewerAgent: {},
    planReviserAgent: {},
    executorAgent: {},
    reviewerAgent: {},
    remediationAgent: {},
    logger: noopLogger,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return { svc, runRepo };
}

describe("OrchestratorService.handleCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ai-plan starts a new run", async () => {
    const { svc } = buildService();
    const startRun = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRun).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai starts a new run (alias of ai-plan)", async () => {
    const { svc } = buildService();
    const startRun = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRun).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan approves and executes when an active run exists", async () => {
    const run = makeRun();
    const { svc, runRepo } = buildService({ findActiveByIssueId: vi.fn().mockResolvedValue(run) });
    const approvePlan = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecution = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
    expect(approvePlan).toHaveBeenCalledWith(run.id);
    expect(runExecution).toHaveBeenCalledWith(run.id);
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { svc } = buildService();
    const approvePlan = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlan).not.toHaveBeenCalled();
  });

  it("reject-plan rejects with the command body when an active run exists", async () => {
    const run = makeRun();
    const { svc } = buildService({ findActiveByIssueId: vi.fn().mockResolvedValue(run) });
    const rejectPlan = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlan).toHaveBeenCalledWith(run.id, "needs more detail", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { svc } = buildService();
    const rejectPlan = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlan).not.toHaveBeenCalled();
  });

  it("re-review re-runs review when an active run exists", async () => {
    const run = makeRun();
    const { svc } = buildService({ findActiveByIssueId: vi.fn().mockResolvedValue(run) });
    const runReview = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReview).toHaveBeenCalledWith(run.id);
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { svc } = buildService();
    const runReview = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReview).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run with a BLOCKED event", async () => {
    const run = makeRun();
    const { svc } = buildService({ findActiveByIssueId: vi.fn().mockResolvedValue(run) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitionAndRecord = vi.spyOn(svc as any, "transitionAndRecord").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(transitionAndRecord).toHaveBeenCalledWith(run, RunEvent.BLOCKED, "user-command");
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { svc } = buildService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitionAndRecord = vi.spyOn(svc as any, "transitionAndRecord").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(transitionAndRecord).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run with a RESET_TO_TODO event", async () => {
    const run = makeRun();
    const { svc } = buildService({ findActiveByIssueId: vi.fn().mockResolvedValue(run) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitionAndRecord = vi.spyOn(svc as any, "transitionAndRecord").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(transitionAndRecord).toHaveBeenCalledWith(run, RunEvent.RESET_TO_TODO, "user-command");
  });

  it("logs a warning for an unknown command and takes no action", async () => {
    const { svc } = buildService();

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/not-a-command" });

    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches comment.command payloads to handleCommand", async () => {
    const { svc } = buildService();
    const handleCommand = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommand).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does nothing for comment.command without a command payload", async () => {
    const { svc } = buildService();
    const handleCommand = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommand).not.toHaveBeenCalled();
  });

  it("does nothing for issue.created and issue.updated actions", async () => {
    const { svc } = buildService();
    const handleCommand = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommand).not.toHaveBeenCalled();
  });
});
