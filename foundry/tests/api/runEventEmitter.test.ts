import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  describe("emitStateChanged", () => {
    it("emits a dashboard event with type run:state-changed and exact payload", () => {
      const emitter = new RunEventEmitter();
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
      expect(() => new Date((event as { timestamp: string }).timestamp).toISOString()).not.toThrow();
    });
  });

  describe("emitArtifactCreated", () => {
    it("emits a dashboard event with type run:artifact-created and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitArtifactCreated("run-2", "Plan", 3);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:artifact-created",
        runId: "run-2",
        artifactType: "Plan",
        version: 3,
      });
    });
  });

  describe("emitRunCreated", () => {
    it("emits a dashboard event with type run:created and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:created",
        runId: "run-3",
        issueId: "LIN-99",
        repo: "org/repo",
      });
    });
  });

  describe("emitProcessStarted", () => {
    it("emits a dashboard event with type process:started and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:started",
        runId: "run-4",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude-code",
        command: "claude plan",
      });
    });
  });

  describe("emitProcessOutput", () => {
    it("emits a dashboard event with type process:output and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessOutput("run-5", "proc-2", "some log chunk\n");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:output",
        runId: "run-5",
        processId: "proc-2",
        chunk: "some log chunk\n",
      });
    });
  });

  describe("emitProcessCompleted", () => {
    it("emits a dashboard event with type process:completed and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "claude-code", 0, 12345);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "process:completed",
        runId: "run-6",
        processId: "proc-3",
        stage: "implementing",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 12345,
      });
    });

    it("preserves a non-zero exit code", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitProcessCompleted("run-6", "proc-4", "implementing", "claude-code", 1, 500);

      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({ exitCode: 1, durationMs: 500 });
    });
  });

  describe("emitQuestionsAnswered", () => {
    it("emits a dashboard event with type run:questions-answered and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitQuestionsAnswered("run-7", 4);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:questions-answered",
        runId: "run-7",
        questionCount: 4,
      });
    });
  });

  describe("emitChatReply", () => {
    it("emits a dashboard event with type run:chat-reply and exact payload", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);

      emitter.emitChatReply("run-8", "Here is the answer", 750);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as DashboardEvent;
      expect(event).toMatchObject({
        type: "run:chat-reply",
        runId: "run-8",
        reply: "Here is the answer",
        durationMs: 750,
      });
    });
  });

  describe("subscribe / unsubscribe semantics", () => {
    it("delivers events to multiple subscribers", () => {
      const emitter = new RunEventEmitter();
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      emitter.on("dashboard", listenerA);
      emitter.on("dashboard", listenerB);

      emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it("stops delivering events to a listener after off() is called", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("dashboard", listener);
      emitter.off("dashboard", listener);

      emitter.emitRunCreated("run-10", "LIN-2", "org/repo");

      expect(listener).not.toHaveBeenCalled();
    });

    it("does not deliver events on unrelated event names", () => {
      const emitter = new RunEventEmitter();
      const listener = vi.fn();
      emitter.on("other-channel", listener);

      emitter.emitRunCreated("run-11", "LIN-3", "org/repo");

      expect(listener).not.toHaveBeenCalled();
    });

    it("does not throw when there are no subscribers", () => {
      const emitter = new RunEventEmitter();
      expect(() => emitter.emitChatReply("run-12", "reply", 10)).not.toThrow();
    });
  });
});
