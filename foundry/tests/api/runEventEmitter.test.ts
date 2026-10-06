import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitArtifactCreated emits a run:artifact-created event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-42", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-42",
      repo: "org/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude --print");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some stdout chunk",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "execution", "codex", 0, 5000);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "execution",
      runtime: "codex",
      exitCode: 0,
      durationMs: 5000,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted preserves a non-zero exit code", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "execution", "codex", 1, 100);

    const [event] = listener.mock.calls[0] as [DashboardEvent];
    expect(event).toMatchObject({ exitCode: 1 });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-7", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with exact payload shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-8", "Here is the answer", 1234);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 1234,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("notifies all subscribed listeners on the same event", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-9", "LIN-1", "repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0]).toEqual(listenerB.mock.calls[0]);
  });

  it("stops notifying a listener after it unsubscribes with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-10", "LIN-1", "repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-10", "LIN-1", "repo");

    // Still only called once, the second emit after unsubscribe reached no one.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when an event is emitted with no listeners subscribed", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-11", "Todo", "Planning")).not.toThrow();
  });

  it("only notifies listeners on the dashboard channel, not on other event names", () => {
    const emitter = new RunEventEmitter();
    const wrongChannelListener = vi.fn();
    emitter.on("other-channel", wrongChannelListener);

    emitter.emitStateChanged("run-12", "Todo", "Planning");

    expect(wrongChannelListener).not.toHaveBeenCalled();
  });

  it("uses the current time for the event timestamp", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    vi.setSystemTime(new Date("2026-06-01T08:30:00.000Z"));
    emitter.emitStateChanged("run-13", "Todo", "Planning");

    const [event] = listener.mock.calls[0] as [DashboardEvent];
    expect(event.timestamp).toBe("2026-06-01T08:30:00.000Z");
  });
});
