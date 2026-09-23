import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";
import { buildFullDeps, makeRun } from "./_helpers/fixtures.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing for 'issue.created' beyond logging", async () => {
    const { deps, linearClient } = buildFullDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("does nothing for 'issue.updated' beyond logging", async () => {
    const { deps } = buildFullDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("dispatches to handleCommand for 'comment.command' when a command is present", async () => {
    const { deps } = buildFullDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command: LinearCommand = { type: "ai-plan" };

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does not dispatch for 'comment.command' when no command is present", async () => {
    const { deps } = buildFullDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  describe("ai-plan / run-ai", () => {
    it("ai-plan calls startRun", async () => {
      const { deps } = buildFullDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "ai-plan" });

      expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    });

    it("run-ai calls startRun", async () => {
      const { deps } = buildFullDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "run-ai" });

      expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    });
  });

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const svc = new OrchestratorService(deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith("run-active");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-active");
    });

    it("does nothing when there is no active run", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan");
      const runExecutionSpy = vi.spyOn(svc, "runExecution");

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
      expect(runExecutionSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source='linear' when an active run exists", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const svc = new OrchestratorService(deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-active", "needs more detail", "linear");
    });

    it("does nothing when there is no active run", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-active");
    });

    it("does nothing when there is no active run", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED", async () => {
      const activeRun = makeRun({ id: "run-active", state: RunState.Implementing });
      const { deps, runRepo } = buildFullDeps(activeRun);
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.AIBlocked);
      expect(runRepo.getCurrent().state).toBe(RunState.AIBlocked);
    });

    it("does nothing when there is no active run", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions the active run back to Todo via RESET_TO_TODO", async () => {
      const activeRun = makeRun({ id: "run-active", state: RunState.AIBlocked });
      const { deps, runRepo } = buildFullDeps(activeRun);
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.Todo);
      expect(runRepo.getCurrent().state).toBe(RunState.Todo);
    });

    it("does nothing when there is no active run", async () => {
      const { deps, runRepo } = buildFullDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("unknown", () => {
    it("logs a warning and performs no state changes", async () => {
      const { deps, runRepo, logger } = buildFullDeps(makeRun());
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "LIN-1" }),
        "Unknown command received",
      );
      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });
});

describe("OrchestratorService getters", () => {
  it("exposes the injected repos and linear client via getters", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildFullDeps(makeRun());
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when not configured", () => {
    const { deps } = buildFullDeps(makeRun());
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});
