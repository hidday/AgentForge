import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun } from "./_fixtures.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("delegates comment.command with a command payload to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" } as LinearCommand,
    });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("does nothing for comment.command with no command payload", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(startRunSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan and run-ai both call startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as LinearCommand);
    await svc.handleCommand("LIN-1", { type: "run-ai" } as LinearCommand);

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: approves and executes the active run when one exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as LinearCommand);

    expect(approvePlanSpy).toHaveBeenCalledWith("run-active");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-active");
  });

  it("approve-plan: does nothing when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as LinearCommand);

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: rejects the active run with the command body", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs OAuth" } as LinearCommand);

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-active", "needs OAuth", "linear");
  });

  it("reject-plan: does nothing when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" } as LinearCommand);

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review: re-reviews the active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "re-review" } as LinearCommand);

    expect(runReviewSpy).toHaveBeenCalledWith("run-active");
  });

  it("re-review: does nothing when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" } as LinearCommand);

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions the active run to BLOCKED", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-active", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-active", state: RunState.AIBlocked }));

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as LinearCommand);

    expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.BLOCKED);
  });

  it("pause-ai: does nothing when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as LinearCommand);

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions the active run back to Todo", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-active", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-active", state: RunState.Todo }));

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as LinearCommand);

    expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.Todo);
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
  });

  it("unknown: logs a warning and does not touch any run", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" } as LinearCommand);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});
