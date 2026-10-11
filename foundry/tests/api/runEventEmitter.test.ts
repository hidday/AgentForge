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

  it("emitStateChanged emits a run:state-changed event with the right shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event with the right shape", () => {
    const emitter = new RunEventEmitter();
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

  it("emitRunCreated emits a run:created event with the right shape", () => {
    const emitter = new RunEventEmitter();
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

  it("emitProcessStarted emits a process:started event with the right shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "Planning", "claude-code", "claude plan");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "Planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event with the right shape", () => {
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

  it("emitProcessCompleted emits a process:completed event with the right shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "Planning", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "Planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the right shape", () => {
    const emitter = new RunEventEmitter();
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

  it("emitChatReply emits a run:chat-reply event with the right shape", () => {
    const emitter = new RunEventEmitter();
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

  it("supports multiple subscribers and unsubscribing via off()", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1); // not called again
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it("does not throw and emits nothing observable when there are no listeners", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });
});
