import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers emitStateChanged to a subscribed listener with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitArtifactCreated with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitRunCreated with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessStarted with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "Implementing", "claude-code", "npm test");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      command: "npm test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessOutput with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "building...");

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "building...",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitProcessCompleted with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "Implementing", "claude-code", 0, 1234);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitQuestionsAnswered with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers emitChatReply with the right payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Hello there", 500);

    expect(listener.mock.calls[0][0]).toEqual({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Hello there",
      durationMs: 500,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("stops delivering events to a listener after it unsubscribes (off)", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-2", "LIN-2", "repo");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with no listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "repo")).not.toThrow();
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });

  it("delivers an emitted event to multiple subscribed listeners", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitQuestionsAnswered("run-1", 2);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("only removes the targeted listener when multiple are subscribed", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
