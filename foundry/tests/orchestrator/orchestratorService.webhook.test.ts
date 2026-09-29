import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildStorefulDeps, makeRun } from "./helpers/testKit.js";

describe("OrchestratorService -- simple accessors", () => {
  it("exposes the injected repos and linear client via getters", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildStorefulDeps(
      makeRun(),
    );
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
  });

  it("returns undefined from getAgentSkillRepo when not injected", () => {
    const { deps } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("returns the injected agentSkillRepo when provided", () => {
    const { deps, agentSkillRepo } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("no-ops on issue.created", async () => {
    const { deps } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });

  it("no-ops on issue.updated", async () => {
    const { deps } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });

  it("delegates to handleCommand when action is comment.command and a command is present", async () => {
    const { deps } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "pause-ai" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("does NOT call handleCommand when action is comment.command but no command is present", async () => {
    const { deps } = buildStorefulDeps(makeRun());
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  describe("ai-plan / run-ai", () => {
    it.each(["ai-plan", "run-ai"] as const)("calls startRun for %s", async (type) => {
      const { deps } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type });

      expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    });
  });

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source 'linear' when an active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED event", async () => {
      const run = makeRun({ id: "run-42", state: RunState.Implementing });
      const { deps, runRepo, store } = buildStorefulDeps(run);
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(store.run.state).toBe(RunState.AIBlocked);
      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions a blocked active run back to Todo via RESET_TO_TODO event", async () => {
      const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
      const { deps, runRepo, store } = buildStorefulDeps(run);
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(store.run.state).toBe(RunState.Todo);
      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("unknown", () => {
    it("logs a warning and takes no action", async () => {
      const { deps, logger, runRepo } = buildStorefulDeps(makeRun());
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "LIN-1" }),
        "Unknown command received",
      );
      expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    });
  });
});
