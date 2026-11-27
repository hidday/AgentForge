import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed event with from/to/timestamp", () => {
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
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-99", "acme/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "acme/repo",
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitProcessStarted emits a process:started event with all fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planner", "claude-code", "claude --print");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitProcessOutput emits a process:output event with the chunk", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "partial output chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "partial output chunk",
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "executor", "codex", 0, 4500);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "executor",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4500,
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitProcessCompleted propagates a non-zero exitCode (failure case)", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.emitProcessCompleted("run-7", "proc-4", "reviewer", "codex", 1, 100);

    expect(listener.mock.calls[0]![0]).toMatchObject({ exitCode: 1 });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-8", 2);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-8",
      questionCount: 2,
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-9", "The plan looks fine.", 777);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-9",
      reply: "The plan looks fine.",
      durationMs: 777,
      timestamp: FIXED_NOW.toISOString(),
    });
  });

  it("supports multiple independent listeners and off() removal", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-10", "LIN-1", "repo");
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-10", "LIN-1", "repo");

    // listenerA was removed and should not have been called again.
    expect(listenerA).toHaveBeenCalledTimes(1);
    // listenerB remains subscribed and receives the second event.
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it("does not throw when emitting with zero listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-11", "LIN-2", "repo")).not.toThrow();
  });
});
