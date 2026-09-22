import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers emitStateChanged events with the correct type and payload to a subscriber", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitArtifactCreated events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitRunCreated events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitProcessStarted events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitProcessOutput events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitProcessCompleted events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitQuestionsAnswered events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 4);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 4,
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers emitChatReply events with the correct type and payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer", 500);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 500,
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("delivers a single emitted event to every subscribed listener", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const listenerC = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);
    emitter.on("dashboard", listenerC);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerC).toHaveBeenCalledTimes(1);
    // All listeners must receive the exact same event payload.
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
    expect(listenerB.mock.calls[0][0]).toEqual(listenerC.mock.calls[0][0]);
  });

  it("stops delivering events to a listener once it has unsubscribed via off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    // No new call recorded after unsubscribing.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("only unsubscribes the specific listener passed to off(), leaving others intact", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("does not deliver events emitted on a different channel", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    // Emit on an unrelated event name directly via the underlying EventEmitter API.
    emitter.emit("other-channel", { foo: "bar" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("produces a fresh ISO timestamp per emitted event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");
    vi.setSystemTime(new Date("2026-05-01T12:05:00.000Z"));
    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    const first = listener.mock.calls[0][0] as DashboardEvent;
    const second = listener.mock.calls[1][0] as DashboardEvent;
    expect(first.timestamp).toBe("2026-05-01T12:00:00.000Z");
    expect(second.timestamp).toBe("2026-05-01T12:05:00.000Z");
    expect(first.timestamp).not.toBe(second.timestamp);
  });

  it("is a real Node EventEmitter instance (extends EventEmitter)", () => {
    const emitter = new RunEventEmitter();
    expect(emitter.listenerCount("dashboard")).toBe(0);
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    expect(emitter.listenerCount("dashboard")).toBe(1);
    emitter.off("dashboard", listener);
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });
});
