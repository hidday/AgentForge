import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun } from "./testHelpers.js";

describe("OrchestratorService -- accessors", () => {
  it("exposes the injected repositories and Linear client via getters", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
  });

  it("returns undefined for getAgentSkillRepo when not configured", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("returns the agentSkillRepo when configured", () => {
    const { deps, agentSkillRepo } = buildDeps({ withAgentSkillRepo: true });
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command payload to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown" } as never,
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "unknown" });
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("does nothing for comment.command with no command payload", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for an unrecognised action", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "something.else", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  let startRunSpy: ReturnType<typeof vi.spyOn>;
  let approvePlanSpy: ReturnType<typeof vi.spyOn>;
  let runExecutionSpy: ReturnType<typeof vi.spyOn>;
  let rejectPlanSpy: ReturnType<typeof vi.spyOn>;
  let runReviewSpy: ReturnType<typeof vi.spyOn>;

  function svcWithSpies(run = makeRun()) {
    const built = buildDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);
    startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(run);
    approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);
    rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);
    runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);
    return { svc, ...built };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ai-plan calls startRun", async () => {
    const { svc } = svcWithSpies();
    await svc.handleCommand("LIN-1", { type: "ai-plan" } as never);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai calls startRun", async () => {
    const { svc } = svcWithSpies();
    await svc.handleCommand("LIN-1", { type: "run-ai" } as never);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const run = makeRun({ id: "run-approve" });
    const { svc } = svcWithSpies(run);
    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);
    expect(approvePlanSpy).toHaveBeenCalledWith("run-approve");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-approve");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithSpies();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);
    expect(approvePlanSpy).not.toHaveBeenCalled();
    expect(runExecutionSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the command body and source 'linear'", async () => {
    const run = makeRun({ id: "run-reject" });
    const { svc } = svcWithSpies(run);
    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "not good" } as never);
    expect(rejectPlanSpy).toHaveBeenCalledWith("run-reject", "not good", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithSpies();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "reject-plan" } as never);
    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const run = makeRun({ id: "run-rereview" });
    const { svc } = svcWithSpies(run);
    await svc.handleCommand("LIN-1", { type: "re-review" } as never);
    expect(runReviewSpy).toHaveBeenCalledWith("run-rereview");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithSpies();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "re-review" } as never);
    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run with BLOCKED from user-command", async () => {
    const run = makeRun({ id: "run-pause", state: RunState.Implementing });
    const { svc, runRepo } = svcWithSpies(run);
    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-pause", RunState.AIBlocked);
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithSpies();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run with RESET_TO_TODO from user-command", async () => {
    const run = makeRun({ id: "run-resume", state: RunState.AIBlocked });
    const { svc, runRepo } = svcWithSpies(run);
    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-resume", RunState.Todo);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const { svc, runRepo } = svcWithSpies();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("logs and no-ops for an unknown command", async () => {
    const { svc, logger } = svcWithSpies();
    await svc.handleCommand("LIN-1", { type: "unknown" } as never);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun -- existing active run", () => {
  it("returns the existing active run without creating a new one", async () => {
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    const { deps, runRepo, plannerAgent } = buildDeps({ run: activeRun });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(activeRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(plannerAgent.run).not.toHaveBeenCalled();
  });
});
