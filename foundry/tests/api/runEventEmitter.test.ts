import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a correctly-shaped run:state-changed event on 'dashboard'", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a correctly-shaped run:artifact-created event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitRunCreated emits a correctly-shaped run:created event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-42", "org/repo");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-42",
      repo: "org/repo",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a correctly-shaped process:started event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "Implementing", "claude-code", "claude run");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      command: "claude run",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a correctly-shaped process:output event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-4", "proc-1", "some stdout chunk");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-4",
      processId: "proc-1",
      chunk: "some stdout chunk",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a correctly-shaped process:completed event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-4", "proc-1", "Implementing", "claude-code", 0, 1234);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-4",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessCompleted carries a non-zero exit code through unchanged", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-5", "proc-2", "AIReview", "codex", 1, 42);

    const event = listener.mock.calls[0][0] as DashboardEvent & { exitCode: number };
    expect(event.exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a correctly-shaped run:questions-answered event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-6", 2);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-6",
      questionCount: 2,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitChatReply emits a correctly-shaped run:chat-reply event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-7", "Here is the answer", 999);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-7",
      reply: "Here is the answer",
      durationMs: 999,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("delivers each event to multiple registered listeners", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-8", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

    // Still only the single call from before removal.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with zero listeners registered", () => {
    expect(() => emitter.emitStateChanged("run-10", "Todo", "Planning")).not.toThrow();
  });

  it("only notifies listeners on the 'dashboard' channel, not other event names", () => {
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("other-channel", otherListener);

    emitter.emitChatReply("run-11", "reply", 10);

    expect(dashboardListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });
});
