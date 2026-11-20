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

  it("extends EventEmitter and starts with no listeners", () => {
    const emitter = new RunEventEmitter();
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("emitStateChanged emits a run:state-changed event with the given fields and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(handler).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handler).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with command and runtime", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-1", "proc-1", "Implementing", "claude-code", "npm test");

    expect(handler).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      command: "npm test",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event with the output chunk", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-1", "proc-1", "building...\n");

    expect(handler).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "building...\n",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "Implementing", "claude-code", 0, 4321);

    expect(handler).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4321,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted reports a non-zero exitCode for a failed process", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "AIReview", "claude-code", 1, 999);

    const event = handler.mock.calls[0][0] as DashboardEvent & { type: "process:completed" };
    expect(event.exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the question count", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(handler).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with the reply text and duration", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-1", "Here is the answer", 250);

    expect(handler).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 250,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("delivers a single emitted event to every subscribed listener", () => {
    const emitter = new RunEventEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
    expect(handlerA.mock.calls[0][0]).toEqual(handlerB.mock.calls[0][0]);
  });

  it("stops notifying a listener once it is unsubscribed with off()", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("unsubscribing one listener does not affect other listeners still subscribed", () => {
    const emitter = new RunEventEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.off("dashboard", handlerA);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledOnce();
    expect(emitter.listenerCount("dashboard")).toBe(1);
  });

  it("emits with fresh timestamps that reflect the current time for each call", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    vi.setSystemTime(new Date("2026-03-15T12:05:00.000Z"));
    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect((handler.mock.calls[0][0] as DashboardEvent).timestamp).toBe("2026-03-15T12:00:00.000Z");
    expect((handler.mock.calls[1][0] as DashboardEvent).timestamp).toBe("2026-03-15T12:05:00.000Z");
  });

  it("emitting with no listeners subscribed does not throw", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "repo")).not.toThrow();
  });
});
