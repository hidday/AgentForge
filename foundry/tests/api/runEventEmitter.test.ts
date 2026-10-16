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

  it("emitStateChanged emits a dashboard event with the correct shape and ISO timestamp", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "Implementing",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitRunCreated emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "org/repo",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessStarted emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessOutput emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "some output chunk");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some output chunk",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "claude-code", 0, 1234);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-7", 2);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitChatReply emits the correct event shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-8", "Here is the answer", 777);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 777,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("delivers the event to multiple independent subscribers", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.calls[0][0]).toEqual(handlerB.mock.calls[0][0]);
  });

  it("stops delivering events to a handler after it unsubscribes", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitRunCreated("run-10", "LIN-2", "org/repo");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-10", "LIN-2", "org/repo");

    // Still only 1 call — the unsubscribed handler received nothing further.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not deliver events to a handler on an unrelated channel", () => {
    const handler = vi.fn();
    emitter.on("other-channel", handler);

    emitter.emitRunCreated("run-11", "LIN-3", "org/repo");

    expect(handler).not.toHaveBeenCalled();
  });
});
