import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
  });

  describe("emitStateChanged", () => {
    it("emits a 'dashboard' event with type run:state-changed and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event.type).toBe("run:state-changed");
      expect(event).toMatchObject({
        type: "run:state-changed",
        runId: "run-1",
        from: "Planning",
        to: "AwaitingPlanApproval",
      });
      expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
      expect(Number.isNaN(Date.parse((event as { timestamp: string }).timestamp))).toBe(false);
    });
  });

  describe("emitArtifactCreated", () => {
    it("emits a 'dashboard' event with type run:artifact-created and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitArtifactCreated("run-1", "Plan", 2);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "Plan",
        version: 2,
      });
    });
  });

  describe("emitRunCreated", () => {
    it("emits a 'dashboard' event with type run:created and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitRunCreated("run-2", "issue-9", "org/repo");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:created",
        runId: "run-2",
        issueId: "issue-9",
        repo: "org/repo",
      });
    });
  });

  describe("emitProcessStarted", () => {
    it("emits a 'dashboard' event with type process:started and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessStarted("run-1", "proc-1", "Implementing", "claude-code", "npm test");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "Implementing",
        runtime: "claude-code",
        command: "npm test",
      });
    });
  });

  describe("emitProcessOutput", () => {
    it("emits a 'dashboard' event with type process:output and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "some output chunk",
      });
    });
  });

  describe("emitProcessCompleted", () => {
    it("emits a 'dashboard' event with type process:completed and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessCompleted("run-1", "proc-1", "Implementing", "claude-code", 0, 1234);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "Implementing",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1234,
      });
    });

    it("preserves a non-zero exit code (failure case)", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessCompleted("run-1", "proc-1", "Implementing", "claude-code", 1, 42);

      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({ exitCode: 1, durationMs: 42 });
    });
  });

  describe("emitQuestionsAnswered", () => {
    it("emits a 'dashboard' event with type run:questions-answered and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitQuestionsAnswered("run-1", 3);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 3,
      });
    });
  });

  describe("emitChatReply", () => {
    it("emits a 'dashboard' event with type run:chat-reply and the given fields", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitChatReply("run-1", "Here is the answer", 777);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is the answer",
        durationMs: 777,
      });
    });
  });

  describe("listener management", () => {
    it("does not throw when emitting with no listeners registered", () => {
      expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
    });

    it("notifies multiple listeners subscribed to the same event", () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      emitter.on("dashboard", listenerA);
      emitter.on("dashboard", listenerB);

      emitter.emitRunCreated("run-3", "issue-3", "org/repo");

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
      expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
    });

    it("stops notifying a listener once it has been removed with off()", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);
      emitter.off("dashboard", listener);

      emitter.emitRunCreated("run-4", "issue-4", "org/repo");

      expect(listener).not.toHaveBeenCalled();
    });

    it("removing a listener that was never registered does not throw and does not affect other listeners", () => {
      const registered = vi.fn();
      const neverRegistered = vi.fn();
      emitter.on("dashboard", registered);

      expect(() => emitter.off("dashboard", neverRegistered)).not.toThrow();

      emitter.emitRunCreated("run-5", "issue-5", "org/repo");

      expect(registered).toHaveBeenCalledTimes(1);
      expect(neverRegistered).not.toHaveBeenCalled();
    });

    it("a listener subscribed to a different event name does not fire for 'dashboard' emissions", () => {
      const dashboardListener = vi.fn();
      const otherListener = vi.fn();
      emitter.on("dashboard", dashboardListener);
      emitter.on("other-channel", otherListener);

      emitter.emitChatReply("run-1", "reply", 10);

      expect(dashboardListener).toHaveBeenCalledTimes(1);
      expect(otherListener).not.toHaveBeenCalled();
    });

    it("emits independent events per call, each carrying its own runId (no cross-firing between runs)", () => {
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitStateChanged("run-a", "Todo", "Planning");
      emitter.emitStateChanged("run-b", "Todo", "Planning");

      expect(listener).toHaveBeenCalledTimes(2);
      const firstEvent = listener.mock.calls[0][0] as DashboardEvent & { runId: string };
      const secondEvent = listener.mock.calls[1][0] as DashboardEvent & { runId: string };
      expect(firstEvent.runId).toBe("run-a");
      expect(secondEvent.runId).toBe("run-b");
    });
  });
});
