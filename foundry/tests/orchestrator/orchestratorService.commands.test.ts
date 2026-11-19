import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun } from "./orchestratorServiceTestHelpers.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("issue.created is a no-op", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    expect(logger.info).toHaveBeenCalled();
  });

  it("issue.updated is a no-op", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });

  it("comment.command with a command delegates to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "re-review" },
    });
    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "re-review" });
  });

  it("comment.command without a command does nothing", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan starts a run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    expect(spy).toHaveBeenCalledWith("LIN-1");
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("run-ai starts a run", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "run-ai" });
    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan approves and executes when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);
    await svc.handleCommand("LIN-1", { type: "approve-plan" });
    expect(approveSpy).toHaveBeenCalledWith("run-5");
    expect(execSpy).toHaveBeenCalledWith("run-5");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan");
    await svc.handleCommand("LIN-1", { type: "approve-plan" });
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject-plan rejects the active run with the command body", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);
    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });
    expect(rejectSpy).toHaveBeenCalledWith("run-5", "needs more detail", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectSpy = vi.spyOn(svc, "rejectPlan");
    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("re-review triggers runReview for the active run", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);
    await svc.handleCommand("LIN-1", { type: "re-review" });
    expect(reviewSpy).toHaveBeenCalledWith("run-5");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runReview");
    await svc.handleCommand("LIN-1", { type: "re-review" });
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run to AIBlocked", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ id: "run-5", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.AIBlocked }));
    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.AIBlocked);
    expect(eventRepo.create).toHaveBeenCalled();
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run back to Todo", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "resume-ai" });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.Todo);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "resume-ai" });
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown command logs a warning and does nothing", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "unknown" });
    expect(logger.warn).toHaveBeenCalled();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
