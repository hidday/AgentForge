import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a dashboard event with the exact expected payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits the correct type, artifactType and version", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitRunCreated emits runId, issueId and repo", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessStarted emits stage, runtime and command", () => {
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
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessOutput emits the raw output chunk", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "some stdout line\n");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some stdout line\n",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits exitCode and durationMs (including a non-zero exit code)", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "codex", 1, 45000);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "codex",
      exitCode: 1,
      durationMs: 45000,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits the question count", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-7", 4);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 4,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitChatReply emits reply text and durationMs", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-8", "Here is the answer.", 1200);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer.",
      durationMs: 1200,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers the same event to multiple subscribers", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-9", "LIN-1", "a/b");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.calls[0][0]).toEqual(handlerB.mock.calls[0][0]);
  });

  it("stops notifying a handler after it unsubscribes via off()", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitRunCreated("run-10", "LIN-2", "a/b");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-10", "LIN-2", "a/b");

    // Still only ever called once — the second emit was not delivered.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with zero subscribers", () => {
    expect(() => emitter.emitStateChanged("run-11", "Todo", "Planning")).not.toThrow();
    expect(() => emitter.emitChatReply("run-11", "reply", 10)).not.toThrow();
  });

  it("only notifies remaining subscribers after one of several unsubscribes", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.off("dashboard", handlerA);
    emitter.emitQuestionsAnswered("run-12", 2);

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("produces a fresh ISO timestamp per call reflecting the current clock", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-13", "LIN-3", "a/b");
    vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    emitter.emitRunCreated("run-13", "LIN-3", "a/b");

    const first = handler.mock.calls[0][0] as DashboardEvent;
    const second = handler.mock.calls[1][0] as DashboardEvent;
    expect(first.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(second.timestamp).toBe("2026-01-01T00:05:00.000Z");
  });
});
