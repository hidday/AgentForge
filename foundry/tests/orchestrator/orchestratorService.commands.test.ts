import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun } from "./orchestratorTestHelpers.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("forwards a comment.command payload to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does nothing for comment.command without a parsed command", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ai-plan and run-ai both call startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
  });

  it("approve-plan approves the active run and starts execution", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun({ id: "run-5" }));
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun({ id: "run-5" }));

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-5");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-5");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the comment body and source=linear", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs OAuth" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-5", "needs OAuth", "linear");
  });

  it("re-review calls runReview on the active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5" }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-5");
  });

  it("pause-ai transitions the active run via BLOCKED", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-5", state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-5", eventType: "BLOCKED" }),
    );
  });

  it("resume-ai transitions a blocked run back to Todo via RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(
      makeRun({ id: "run-5", state: RunState.AIBlocked }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-5", eventType: "RESET_TO_TODO" }),
    );
  });

  it("logs a warning and takes no action for an unknown command", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
