import { describe, it, expect, vi, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
  });

  it("emitArtifactCreated emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-99", "org/repo");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-99",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude", "claude -p hello");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude",
      command: "claude -p hello",
    });
  });

  it("emitProcessOutput emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output chunk",
    });
  });

  it("emitProcessCompleted emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude", 0, 1234);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a 'dashboard' event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-1", "Hello there", 500);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Hello there",
      durationMs: 500,
    });
  });

  it("fans out a single emitted event to multiple listeners", () => {
    const emitter = new RunEventEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const handlerC = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);
    emitter.on("dashboard", handlerC);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerC).toHaveBeenCalledTimes(1);
    // All three listeners should have received the exact same event object.
    expect(handlerA.mock.calls[0][0]).toBe(handlerB.mock.calls[0][0]);
    expect(handlerB.mock.calls[0][0]).toBe(handlerC.mock.calls[0][0]);
  });

  it("stops notifying a listener once it is removed with off()", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    // Still only called once — the removed listener received nothing further.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not notify listeners subscribed to a different event name", () => {
    const emitter = new RunEventEmitter();
    const dashboardHandler = vi.fn();
    const otherHandler = vi.fn();
    emitter.on("dashboard", dashboardHandler);
    emitter.on("other-event", otherHandler);

    emitter.emitChatReply("run-1", "hi", 10);

    expect(dashboardHandler).toHaveBeenCalledTimes(1);
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it("does not throw and silently drops the event when there are no listeners", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });

  it("generates independent ISO timestamps per emitted event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");

    const firstTimestamp = (handler.mock.calls[0][0] as { timestamp: string }).timestamp;
    const secondTimestamp = (handler.mock.calls[1][0] as { timestamp: string }).timestamp;
    expect(firstTimestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(secondTimestamp).toBe("2026-01-01T00:00:05.000Z");
    expect(firstTimestamp).not.toBe(secondTimestamp);
  });
});
