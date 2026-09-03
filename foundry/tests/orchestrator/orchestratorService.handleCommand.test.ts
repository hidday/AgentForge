import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";
import { buildDeps, makeStore } from "./helpers/fixtures.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing for issue.created", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("does nothing for issue.updated", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for comment.command when a command is present", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command: LinearCommand = { type: "unknown", raw: "/nonsense" };

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand for comment.command when no command is present", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan delegates to startRun", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(store.run);

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai delegates to startRun", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(store.run);

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("approve-plan", () => {
    it("approves the plan and runs execution when there is an active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
      const svc = new OrchestratorService(built.deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(store.run);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith("run-1");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-1");
    });

    it("does nothing when there is no active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(built.deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan");
      const runExecutionSpy = vi.spyOn(svc, "runExecution");

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
      expect(runExecutionSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("rejects the plan with the command body and source='linear' when there is an active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
      const svc = new OrchestratorService(built.deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "not good enough" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-1", "not good enough", "linear");
    });

    it("does nothing when there is no active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(built.deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("delegates to runReview when there is an active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
      const svc = new OrchestratorService(built.deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(store.run);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    });

    it("does nothing when there is no active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(built.deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED, recording source 'user-command'", async () => {
      const store = makeStore({ state: RunState.Todo });
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(store.run.state).toBe(RunState.AIBlocked);
      const eventCall = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
      );
      expect(eventCall).toBeDefined();
      expect((eventCall![0] as { source: string }).source).toBe("user-command");
    });

    it("does nothing when there is no active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(built.runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions the active (blocked) run back to Todo via RESET_TO_TODO", async () => {
      const store = makeStore({ state: RunState.AIBlocked });
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue({ ...store.run });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(store.run.state).toBe(RunState.Todo);
      const eventCall = built.eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
      );
      expect(eventCall).toBeDefined();
    });

    it("does nothing when there is no active run", async () => {
      const store = makeStore();
      const built = buildDeps(store);
      built.runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(built.runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/nonsense" });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(built.runRepo.updateState).not.toHaveBeenCalled();
  });
});
