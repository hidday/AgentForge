import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is an instance of node's EventEmitter", () => {
    expect(emitter).toBeInstanceOf(EventEmitter);
  });

  it("emitStateChanged emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "Implementing",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-9", "org/repo");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-9",
      repo: "org/repo",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude -p ...");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude -p ...",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some stdout chunk",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "codex", 0, 4200);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4200,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-7", 2);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a 'dashboard' event with the correct shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-8", "Here is the answer", 750);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 750,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("delivers a single emitted event to multiple subscribed listeners", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("stops notifying a listener after it unsubscribes via off()", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-10", "LIN-2", "org/repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-10", "LIN-2", "org/repo");

    // Still only the one call from before unsubscribing.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing one listener does not affect other still-subscribed listeners", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-11", "LIN-3", "org/repo");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with no listeners subscribed", () => {
    expect(() => emitter.emitStateChanged("run-12", "Todo", "Planning")).not.toThrow();
  });

  it("produces a fresh ISO timestamp per emitted event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-13", "LIN-4", "org/repo");
    vi.setSystemTime(new Date("2026-01-15T12:05:00.000Z"));
    emitter.emitRunCreated("run-13", "LIN-4", "org/repo");

    expect(listener).toHaveBeenCalledTimes(2);
    expect((listener.mock.calls[0][0] as DashboardEvent).timestamp).toBe(
      "2026-01-15T12:00:00.000Z",
    );
    expect((listener.mock.calls[1][0] as DashboardEvent).timestamp).toBe(
      "2026-01-15T12:05:00.000Z",
    );
  });
});
