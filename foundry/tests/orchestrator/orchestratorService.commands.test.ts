import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun } from "./fixtures.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("issue.created is a no-op", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "issue.created", issueId: "LIN-1" }),
      "Handling Linear webhook",
    );
  });

  it("issue.updated is a no-op", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("comment.command with a command dispatches to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown" },
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "unknown" });
  });

  it("comment.command without a command does NOT dispatch", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan starts a run", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai starts a run", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan approves and executes when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-42");
    expect(execSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approveSpy = vi.spyOn(svc, "approvePlan");
    const execSpy = vi.spyOn(svc, "runExecution");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("reject-plan rejects the plan with the command body when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "no good" });

    expect(rejectSpy).toHaveBeenCalledWith("run-42", "no good", "linear");
  });

  it("reject-plan does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("re-review re-reviews the plan when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const reviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions an active run to AIBlocked via BLOCKED", async () => {
    const { deps, runRepo, eventRepo, linearSync, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.AIBlocked }));
    linearSync.syncState.mockResolvedValue(undefined);
    githubSync.syncState.mockResolvedValue(undefined);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
    const call = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(call).toBeDefined();
    expect((call![0] as { source: string }).source).toBe("user-command");
  });

  it("pause-ai does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions a blocked run back to Todo via RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.Todo }));

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
    const call = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(call).toBeDefined();
  });

  it("resume-ai does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown command logs a warning and does nothing else", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.startRun (active-run short-circuit)", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const existing = makeRun({ id: "existing-run", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});
