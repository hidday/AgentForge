import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a correctly shaped event on the 'dashboard' channel", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude --print");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "partial output chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "partial output chunk",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planner", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 2);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 2,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits the correct event shape", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer", 500);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 500,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("delivers an emitted event to every registered listener", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0]).toEqual(listenerB.mock.calls[0]);
  });

  it("does not throw and delivers nothing when emitting with no listeners attached", () => {
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "org/repo")).not.toThrow();
  });

  it("stops delivering to a listener removed via off()", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).not.toHaveBeenCalled();
  });

  it("removing one listener mid-emit does not prevent other listeners already queued from firing on that same emit", () => {
    const order: string[] = [];
    const listenerB = vi.fn(() => order.push("b"));
    const listenerA = vi.fn(() => {
      order.push("a");
      // Removing B from inside A's handler — Node's EventEmitter snapshots
      // the listener array before invoking, so B still fires for this emit.
      emitter.off("dashboard", listenerB);
    });
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(order).toEqual(["a", "b"]);

    // But a subsequent emit no longer reaches the removed listener.
    listenerA.mockClear();
    listenerB.mockClear();
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo2");
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });

  it("isolates listeners on other event names from 'dashboard' emissions", () => {
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("other-channel", otherListener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(dashboardListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });

  it("produces independent timestamps across separate emits", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    vi.setSystemTime(new Date("2026-03-15T12:00:05.000Z"));
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect((listener.mock.calls[0]![0] as DashboardEvent).timestamp).toBe("2026-03-15T12:00:00.000Z");
    expect((listener.mock.calls[1]![0] as DashboardEvent).timestamp).toBe("2026-03-15T12:00:05.000Z");
  });
});
