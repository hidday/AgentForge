import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event with the given fields on the 'dashboard' channel", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(new Date((event as { timestamp: string }).timestamp).toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("emits a run:artifact-created event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emits a run:created event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-9", "acme/widgets");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-9",
      repo: "acme/widgets",
    });
  });

  it("emits a process:started event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
    });
  });

  it("emits a process:output event with the given chunk", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout text");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout text",
    });
  });

  it("emits a process:completed event with exit code and duration", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emits a non-zero exit code for a failed process", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "executing", "codex", 1, 500);

    expect(listener.mock.calls[0][0]).toMatchObject({ exitCode: 1 });
  });

  it("emits a run:questions-answered event with the question count", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 4);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 4,
    });
  });

  it("emits a run:chat-reply event with reply text and duration", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer", 42);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 42,
    });
  });

  it("delivers events to multiple subscribers on the same channel", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-2", "LIN-2", "acme/widgets");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("stops delivering events to a subscriber after it unsubscribes", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    // Still only the one call from before unsubscribing.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw and does not notify unrelated channels when there are no subscribers", () => {
    const emitter = new RunEventEmitter();
    const otherChannelListener = vi.fn();
    emitter.on("other-channel", otherChannelListener);

    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets")).not.toThrow();
    expect(otherChannelListener).not.toHaveBeenCalled();
  });
});
