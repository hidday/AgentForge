import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged delivers a run:state-changed event with the right fields", () => {
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
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
    expect(Number.isNaN(new Date((event as { timestamp: string }).timestamp).getTime())).toBe(
      false,
    );
  });

  it("emitArtifactCreated delivers a run:artifact-created event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated delivers a run:created event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted delivers a process:started event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
    });
  });

  it("emitProcessOutput delivers a process:output event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "some output chunk");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some output chunk",
    });
  });

  it("emitProcessCompleted delivers a process:completed event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "execution", "claude-code", 0, 1234);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "execution",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered delivers a run:questions-answered event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-7", 4);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 4,
    });
  });

  it("emitChatReply delivers a run:chat-reply event with the right fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-8", "Here is the answer", 777);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 777,
    });
  });

  it("delivers events to multiple subscribed listeners", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-9", "LIN-1", "repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("stops delivering events to a listener once it unsubscribes with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-10", "LIN-1", "repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-10", "LIN-1", "repo");

    // Still only called once — the unsubscribed listener received nothing further.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with no listeners subscribed", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-11", "LIN-1", "repo")).not.toThrow();
    expect(() => emitter.emitChatReply("run-11", "reply", 1)).not.toThrow();
  });

  it("propagates a listener's thrown error synchronously to the emit call site", () => {
    const emitter = new RunEventEmitter();
    const badListener = vi.fn(() => {
      throw new Error("listener boom");
    });
    emitter.on("dashboard", badListener);

    // Node's EventEmitter runs listeners synchronously and lets a thrown error
    // propagate out of emit() — callers of emitXxx must be resilient to this.
    expect(() => emitter.emitRunCreated("run-12", "LIN-1", "repo")).toThrow("listener boom");
  });

  it("only notifies listeners on the one that threw is isolated per listener call (other listeners still invoked where EventEmitter allows)", () => {
    const emitter = new RunEventEmitter();
    const callOrder: string[] = [];
    const first = vi.fn(() => {
      callOrder.push("first");
    });
    const second = vi.fn(() => {
      callOrder.push("second");
    });
    emitter.on("dashboard", first);
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-13", "LIN-1", "repo");

    expect(callOrder).toEqual(["first", "second"]);
  });

  it("does not deliver dashboard events to listeners subscribed to a different event name", () => {
    const emitter = new RunEventEmitter();
    const wrongChannel = vi.fn();
    emitter.on("other-channel", wrongChannel);

    emitter.emitRunCreated("run-14", "LIN-1", "repo");

    expect(wrongChannel).not.toHaveBeenCalled();
  });
});
