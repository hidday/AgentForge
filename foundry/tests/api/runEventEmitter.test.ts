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

  it("emits a run:state-changed dashboard event with the given fields and current timestamp", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a run:artifact-created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a run:created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a process:started dashboard event", () => {
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
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a process:output dashboard event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a process:completed dashboard event", () => {
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
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a run:questions-answered dashboard event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emits a run:chat-reply dashboard event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer", 987);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 987,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("fans out a single emitted event to multiple subscribers", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("stops notifying a listener once it has been removed with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with zero subscribers", () => {
    const emitter = new RunEventEmitter();

    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });

  it("does not notify a listener subscribed to a different event name", () => {
    const emitter = new RunEventEmitter();
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("something-else", otherListener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(dashboardListener).toHaveBeenCalledOnce();
    expect(otherListener).not.toHaveBeenCalled();
  });
});
