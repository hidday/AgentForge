import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    emitter = new RunEventEmitter();
    listener = vi.fn();
    emitter.on("dashboard", listener);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with command and runtime", () => {
    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude --print");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event carrying the chunk", () => {
    emitter.emitProcessOutput("run-1", "proc-1", "partial output chunk");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "partial output chunk",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "codex", 0, 4200);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4200,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted preserves a non-zero exitCode", () => {
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "codex", 1, 100);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type === "process:completed" && event.exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the count", () => {
    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and duration", () => {
    emitter.emitChatReply("run-1", "Here is the answer", 850);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 850,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("supports multiple independent listeners on the dashboard channel", () => {
    const second = vi.fn();
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-2", "LIN-2", "acme/repo2");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener once it has been removed with off()", () => {
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-3", "acme/repo3");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no listeners attached", () => {
    const freshEmitter = new RunEventEmitter();
    expect(() => freshEmitter.emitRunCreated("run-4", "LIN-4", "acme/repo4")).not.toThrow();
  });
});
