import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";
import { makeRun, buildFullDeps } from "./testHelpers.js";

describe("OrchestratorService.handleLinearWebhook", () => {
  it("routes 'comment.command' with a command to handleCommand", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildFullDeps({ run });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "reject-plan", body: "nope" },
    });

    expect(spy).toHaveBeenCalledWith(run.id, "nope", "linear");
  });

  it("does nothing for 'comment.command' when no command is attached", async () => {
    const run = makeRun();
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op for 'issue.created'", async () => {
    const run = makeRun();
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for 'issue.updated'", async () => {
    const run = makeRun();
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("OrchestratorService.handleCommand", () => {
  function svcWithSpies(run = makeRun()) {
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);
    return { svc, built };
  }

  it.each(["ai-plan", "run-ai"] as const)(
    "'%s' calls startRun with the issueId",
    async (type) => {
      const { svc } = svcWithSpies();
      const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type } as LinearCommand);

      expect(spy).toHaveBeenCalledWith("LIN-1");
    },
  );

  it("'approve-plan' with an active run calls approvePlan then runExecution with that run's id", async () => {
    const run = makeRun({ id: "run-42" });
    const { svc, built } = svcWithSpies(run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-42");
    expect(execSpy).toHaveBeenCalledWith("run-42");
  });

  it("'approve-plan' with no active run does nothing", async () => {
    const { svc, built } = svcWithSpies();
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approveSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("'reject-plan' with an active run calls rejectPlan with the body and source='linear'", async () => {
    const run = makeRun({ id: "run-42" });
    const { svc, built } = svcWithSpies(run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "use OAuth" });

    expect(spy).toHaveBeenCalledWith("run-42", "use OAuth", "linear");
  });

  it("'reject-plan' with no active run does nothing", async () => {
    const { svc, built } = svcWithSpies();
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const spy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("'re-review' with an active run calls runReview with that run's id", async () => {
    const run = makeRun({ id: "run-77" });
    const { svc, built } = svcWithSpies(run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const spy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).toHaveBeenCalledWith("run-77");
  });

  it("'re-review' with no active run does nothing", async () => {
    const { svc, built } = svcWithSpies();
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const spy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("'pause-ai' with an active run records a BLOCKED transition sourced 'user-command'", async () => {
    const run = makeRun({ id: "run-5", state: RunState.Implementing });
    const { svc, built } = svcWithSpies(run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    const blockedEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedEvent).toBeDefined();
    expect((blockedEvent![0] as { source: string }).source).toBe("user-command");
    expect(built.store.runState).toBe(RunState.AIBlocked);
  });

  it("'pause-ai' with no active run does nothing", async () => {
    const { svc, built } = svcWithSpies();
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(built.eventRepo.create).not.toHaveBeenCalled();
  });

  it("'resume-ai' with an active run records a RESET_TO_TODO transition back to Todo", async () => {
    const run = makeRun({ id: "run-6", state: RunState.AIBlocked });
    const { svc, built } = svcWithSpies(run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(built.store.runState).toBe(RunState.Todo);
    const resumeEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect((resumeEvent![0] as { source: string }).source).toBe("user-command");
  });

  it("'resume-ai' with no active run does nothing", async () => {
    const { svc, built } = svcWithSpies();
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(built.eventRepo.create).not.toHaveBeenCalled();
  });

  it("'unknown' command logs a warning and performs no run action", async () => {
    const { svc, built } = svcWithSpies();

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
