import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

function captureEvent(emitter: RunEventEmitter): { listener: ReturnType<typeof vi.fn> } {
  const listener = vi.fn();
  emitter.on("dashboard", listener);
  return { listener };
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(() => new Date(event.timestamp as string).toISOString()).not.toThrow();
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a process:started event with stage/runtime/command", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "claude");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "claude",
    });
  });

  it("emitProcessOutput emits a process:output event carrying the chunk", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "partial output text");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "partial output text",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1500);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the count", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a run:chat-reply event with the reply text and durationMs", () => {
    const emitter = new RunEventEmitter();
    const { listener } = captureEvent(emitter);

    emitter.emitChatReply("run-1", "Here's my answer.", 842);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here's my answer.",
      durationMs: 842,
    });
  });

  it("supports multiple independent listeners receiving the same event", () => {
    const emitter = new RunEventEmitter();
    const { listener: listenerA } = captureEvent(emitter);
    const { listener: listenerB } = captureEvent(emitter);

    emitter.emitRunCreated("run-2", "LIN-2", "org/repo2");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitted with no listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-3", "Todo", "Planning")).not.toThrow();
  });
});
