import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed dashboard event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
    expect(Number.isNaN(new Date((event as { timestamp: string }).timestamp).getTime())).toBe(
      false,
    );
  });

  it("emitArtifactCreated emits a run:artifact-created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated emits a run:created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a process:started dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-4", "proc-1", "executor", "claude-code", "claude --print");

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "claude --print",
    });
  });

  it("emitProcessOutput emits a process:output dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some stdout chunk",
    });
  });

  it("emitProcessCompleted emits a process:completed dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "reviewer", "codex", 0, 1234);

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "reviewer",
      runtime: "codex",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-7", 2);

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
    });
  });

  it("emitChatReply emits a run:chat-reply dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-8", "Here is the answer.", 777);

    expect(handler.mock.calls[0]![0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer.",
      durationMs: 777,
    });
  });

  it("delivers to multiple subscribers on the same dashboard channel", () => {
    const emitter = new RunEventEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.calls[0]![0]).toEqual(handlerB.mock.calls[0]![0]);
  });

  it("does not throw when emitting with no subscribers", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-10", "LIN-2", "org/repo")).not.toThrow();
  });

  it("stops delivering to a handler once it is unsubscribed with off()", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.off("dashboard", handler);

    emitter.emitRunCreated("run-11", "LIN-3", "org/repo");

    expect(handler).not.toHaveBeenCalled();
  });

  it("only delivers dashboard events to listeners on the 'dashboard' channel", () => {
    const emitter = new RunEventEmitter();
    const wrongChannel = vi.fn();
    emitter.on("other-channel", wrongChannel);

    emitter.emitRunCreated("run-12", "LIN-4", "org/repo");

    expect(wrongChannel).not.toHaveBeenCalled();
  });
});
