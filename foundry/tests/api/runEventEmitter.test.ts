import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers emitStateChanged events with the correct shape to a listener", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(listener).toHaveBeenCalledTimes(1);
    const event: DashboardEvent = listener.mock.calls[0][0];
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitArtifactCreated events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitRunCreated events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitProcessStarted events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude --print");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitProcessOutput events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitProcessCompleted events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1500);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitQuestionsAnswered events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers emitChatReply events with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "here is my reply", 820);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "here is my reply",
      durationMs: 820,
      timestamp: "2024-05-01T10:00:00.000Z",
    });
  });

  it("delivers a single emitted event to every listener registered on the 'dashboard' channel", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0]).toEqual(listenerB.mock.calls[0]);
  });

  it("stops delivering events to a listener after off() is called", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    // still only the one call from before off() was invoked
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not deliver events to listeners on unrelated channels", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("some-other-channel", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports one-time listeners via once(), firing only on the next emission", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.once("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("produces a fresh ISO timestamp per call, reflecting the current clock", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    vi.setSystemTime(new Date("2024-05-01T10:05:00.000Z"));
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener.mock.calls[0][0].timestamp).toBe("2024-05-01T10:00:00.000Z");
    expect(listener.mock.calls[1][0].timestamp).toBe("2024-05-01T10:05:00.000Z");
  });
});
