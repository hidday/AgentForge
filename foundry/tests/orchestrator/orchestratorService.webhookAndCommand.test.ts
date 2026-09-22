import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, createStore, makeRun } from "./testSupport.js";

describe("OrchestratorService simple accessors", () => {
  it("exposes the injected repositories and clients via getters", () => {
    const store = createStore(makeRun());
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps(store);
    const agentSkillRepo = { findTopKByRelevance: vi.fn(), incrementSuccess: vi.fn(), incrementFailure: vi.fn(), archiveIfLowUtility: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when no skill repo was injected", () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command to handleCommand", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not call handleCommand for comment.command when no command is present", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for an unrecognised action (falls through switch)", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "something.else", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("OrchestratorService.handleCommand", () => {
  let store: ReturnType<typeof createStore>;
  let deps: ReturnType<typeof buildDeps>["deps"];
  let runRepo: ReturnType<typeof buildDeps>["runRepo"];
  let svc: OrchestratorService;

  beforeEach(() => {
    store = createStore(makeRun());
    const built = buildDeps(store);
    deps = built.deps;
    runRepo = built.runRepo;
    svc = new OrchestratorService(deps as never);
  });

  it("ai-plan calls startRun with the issueId", async () => {
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai calls startRun with the issueId", async () => {
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "run-ai" });
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-active");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-active");
  });

  it("approve-plan does nothing when no active run exists for the issue", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the run id, body, and 'linear' source when an active run exists", async () => {
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-active", "needs work", "linear");
  });

  it("reject-plan does nothing when no active run exists", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const activeRun = makeRun({ id: "run-active" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-active");
  });

  it("re-review does nothing when no active run exists", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run via BLOCKED with source 'user-command'", async () => {
    const activeRun = makeRun({ id: "run-active", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    const blockedCall = (deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedCall).toBeDefined();
    expect((blockedCall![0] as { source: string }).source).toBe("user-command");
  });

  it("pause-ai does nothing when no active run exists", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect((deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run via RESET_TO_TODO with source 'user-command'", async () => {
    const activeRun = makeRun({ id: "run-active", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    const resetCall = (deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(resetCall).toBeDefined();
    expect((resetCall![0] as { source: string }).source).toBe("user-command");
  });

  it("resume-ai does nothing when no active run exists", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect((deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });

  it("unknown command logs a warning and does not touch the run repo", async () => {
    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect((deps.logger as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
