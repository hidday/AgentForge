import { describe, it, expect, vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
import { createHarness, makeRun } from "./orchestratorHarness.js";

describe("OrchestratorService accessors", () => {
  it("exposes the injected repositories and clients", () => {
    const h = createHarness({ withSkillRepo: true });
    expect(h.svc.getRunRepo()).toBe(h.runRepo);
    expect(h.svc.getArtifactRepo()).toBe(h.artifactRepo);
    expect(h.svc.getEventRepo()).toBe(h.eventRepo);
    expect(h.svc.getLinearClient()).toBe(h.linearClient);
    expect(h.svc.getAgentSkillRepo()).toBe(h.agentSkillRepo);
  });

  it("returns undefined for the optional skill repo when not configured", () => {
    const h = createHarness();
    expect(h.svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it.each(["issue.created", "issue.updated", "something.else"])(
    "is a no-op for action %s (no command dispatch)",
    async (action) => {
      const h = createHarness();
      const spy = vi.spyOn(h.svc, "handleCommand");
      await h.svc.handleLinearWebhook({ action, issueId: "LIN-1" });
      expect(spy).not.toHaveBeenCalled();
      expect(h.logger.info).toHaveBeenCalledWith(
        { action, issueId: "LIN-1" },
        "Handling Linear webhook",
      );
    },
  );

  it("dispatches comment.command payloads that carry a parsed command", async () => {
    const h = createHarness();
    const spy = vi.spyOn(h.svc, "handleCommand").mockResolvedValue(undefined);
    await h.svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "pause-ai" },
    });
    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("ignores comment.command payloads without a command", async () => {
    const h = createHarness();
    const spy = vi.spyOn(h.svc, "handleCommand");
    await h.svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it.each(["ai-plan", "run-ai"] as const)("%s starts a run for the issue", async (type) => {
    const h = createHarness();
    const spy = vi.spyOn(h.svc, "startRun").mockResolvedValue(makeRun());
    await h.svc.handleCommand("LIN-1", { type });
    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan approves the active run then starts execution, in that order", async () => {
    const h = createHarness();
    h.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const order: string[] = [];
    const approve = vi.spyOn(h.svc, "approvePlan").mockImplementation(async () => {
      order.push("approve");
      return makeRun();
    });
    const exec = vi.spyOn(h.svc, "runExecution").mockImplementation(async () => {
      order.push("execute");
      return makeRun();
    });
    await h.svc.handleCommand("LIN-1", { type: "approve-plan" });
    expect(approve).toHaveBeenCalledWith("run-1");
    expect(exec).toHaveBeenCalledWith("run-1");
    expect(order).toEqual(["approve", "execute"]);
  });

  it("reject-plan forwards the comment body with source 'linear'", async () => {
    const h = createHarness();
    h.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const spy = vi.spyOn(h.svc, "rejectPlan").mockResolvedValue(makeRun());
    await h.svc.handleCommand("LIN-1", { type: "reject-plan", body: "use redis" });
    expect(spy).toHaveBeenCalledWith("run-1", "use redis", "linear");
  });

  it("re-review triggers a code review of the active run", async () => {
    const h = createHarness();
    h.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-1" }));
    const spy = vi.spyOn(h.svc, "runReview").mockResolvedValue(makeRun());
    await h.svc.handleCommand("LIN-1", { type: "re-review" });
    expect(spy).toHaveBeenCalledWith("run-1");
  });

  it("pause-ai blocks the active run via the state machine and records the user-command source", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const h = createHarness({ run });
    h.runRepo.findActiveByIssueId.mockResolvedValue(run);
    await h.svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(h.currentRun().state).toBe(RunState.AIBlocked);
    const evt = h.state.events.at(-1)!;
    expect(evt.eventType).toBe(RunEvent.BLOCKED);
    expect(h.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: "user-command" }),
    );
    expect(evt.payloadJson).toEqual({ from: RunState.Implementing, to: RunState.AIBlocked });
    expect(h.linearSync.syncState).toHaveBeenCalledWith(
      expect.objectContaining({ state: RunState.AIBlocked }),
    );
    expect(h.githubSync.syncState).toHaveBeenCalledTimes(1);
    expect(h.dashboardEmitter.emitStateChanged).toHaveBeenCalledWith(
      "run-1",
      RunState.Implementing,
      RunState.AIBlocked,
    );
  });

  it("resume-ai resets a blocked run back to Todo", async () => {
    const run = makeRun({ state: RunState.AIBlocked });
    const h = createHarness({ run });
    h.runRepo.findActiveByIssueId.mockResolvedValue(run);
    await h.svc.handleCommand("LIN-1", { type: "resume-ai" });
    expect(h.currentRun().state).toBe(RunState.Todo);
    expect(h.eventTypes()).toEqual([RunEvent.RESET_TO_TODO]);
  });

  it("resume-ai on a run that is not blocked surfaces the state-machine error and changes nothing", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const h = createHarness({ run });
    h.runRepo.findActiveByIssueId.mockResolvedValue(run);
    await expect(h.svc.handleCommand("LIN-1", { type: "resume-ai" })).rejects.toBeInstanceOf(
      StateTransitionError,
    );
    expect(h.currentRun().state).toBe(RunState.Implementing);
    expect(h.state.events).toHaveLength(0);
    expect(h.runRepo.updateState).not.toHaveBeenCalled();
  });

  it.each(["approve-plan", "reject-plan", "re-review", "pause-ai", "resume-ai"] as const)(
    "%s is a no-op when the issue has no active run",
    async (type) => {
      const h = createHarness();
      const spies = [
        vi.spyOn(h.svc, "approvePlan"),
        vi.spyOn(h.svc, "runExecution"),
        vi.spyOn(h.svc, "rejectPlan"),
        vi.spyOn(h.svc, "runReview"),
      ];
      await h.svc.handleCommand("LIN-404", { type });
      expect(h.runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-404");
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      expect(h.runRepo.updateState).not.toHaveBeenCalled();
      expect(h.state.events).toHaveLength(0);
    },
  );

  it("unknown commands are logged as a warning and nothing else happens", async () => {
    const h = createHarness();
    await h.svc.handleCommand("LIN-1", { type: "unknown", raw: "/foo" });
    expect(h.logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown", raw: "/foo" } },
      "Unknown command received",
    );
    expect(h.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService transitions without a dashboard emitter", () => {
  it("still transitions and syncs when dashboardEmitter is not configured", async () => {
    const run = makeRun({ state: RunState.Planning });
    const h = createHarness({ run, withDashboard: false });
    h.runRepo.findActiveByIssueId.mockResolvedValue(run);
    await h.svc.handleCommand("LIN-1", { type: "pause-ai" });
    expect(h.currentRun().state).toBe(RunState.AIBlocked);
    expect(h.dashboardEmitter.emitStateChanged).not.toHaveBeenCalled();
    expect(h.linearSync.syncState).toHaveBeenCalledTimes(1);
  });
});
