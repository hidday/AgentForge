import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("delivers emitStateChanged with the exact payload to a subscriber", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("delivers emitArtifactCreated with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(handler).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitRunCreated with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handler).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessStarted with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude -p plan");

    expect(handler).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude -p plan",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessOutput with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(handler).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessCompleted with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(handler).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitQuestionsAnswered with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-1", 2);

    expect(handler).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitChatReply with the exact payload", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-1", "Here is the answer", 42);

    expect(handler).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 42,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("stamps each emitted event with a fresh timestamp", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    vi.setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    emitter.emitRunCreated("run-2", "LIN-2", "repo");

    expect(handler).toHaveBeenCalledTimes(2);
    expect((handler.mock.calls[0][0] as DashboardEvent).timestamp).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect((handler.mock.calls[1][0] as DashboardEvent).timestamp).toBe(
      "2026-01-01T00:05:00.000Z",
    );
  });

  it("supports multiple concurrent subscribers all receiving the same event", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.calls[0][0]).toEqual(handlerB.mock.calls[0][0]);
  });

  it("stops delivering events to a listener once it has unsubscribed", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-2", "LIN-2", "repo");

    // Still only the single call from before unsubscribing.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing one listener does not affect other active listeners", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.off("dashboard", handlerA);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("emitting with no subscribers does not throw", () => {
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "repo")).not.toThrow();
    expect(() => emitter.emitChatReply("run-1", "reply", 1)).not.toThrow();
  });

  it("delivers events scoped per-runId equally to all dashboard subscribers (no run filtering)", () => {
    // RunEventEmitter emits every event on a single shared "dashboard" channel;
    // it does not filter by runId itself — consumers filter client-side.
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-a", "Todo", "Planning");
    emitter.emitStateChanged("run-b", "Todo", "Planning");

    expect(handler).toHaveBeenCalledTimes(2);
    expect((handler.mock.calls[0][0] as DashboardEvent & { runId: string }).runId).toBe("run-a");
    expect((handler.mock.calls[1][0] as DashboardEvent & { runId: string }).runId).toBe("run-b");
  });

  it("is a real EventEmitter instance supporting once() semantics", () => {
    const handler = vi.fn();
    emitter.once("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    emitter.emitRunCreated("run-2", "LIN-2", "repo");

    // once() should only fire for the first emitted event.
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
