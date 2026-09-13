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

  it("emitStateChanged emits a 'dashboard' event with the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitArtifactCreated emits the exact expected payload", () => {
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
    } satisfies DashboardEvent);
  });

  it("emitRunCreated emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-42", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-42",
      repo: "org/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitProcessStarted emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "implement", "claude-code", "npm test");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "implement",
      runtime: "claude-code",
      command: "npm test",
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitProcessOutput emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output chunk",
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitProcessCompleted emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "implement", "claude-code", 0, 4200);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "implement",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4200,
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitQuestionsAnswered emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("emitChatReply emits the exact expected payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer", 750);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 750,
      timestamp: "2026-03-15T12:00:00.000Z",
    } satisfies DashboardEvent);
  });

  it("supports multiple simultaneous listeners, all receiving the same event", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0]).toEqual(listenerB.mock.calls[0]);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    // Still only called once — the second emit was not delivered.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw and no-ops when emitting with zero listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "org/repo")).not.toThrow();
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("only delivers events on the 'dashboard' channel, not other event names", () => {
    const emitter = new RunEventEmitter();
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("other-channel", otherListener);

    emitter.emitChatReply("run-1", "hi", 10);

    expect(dashboardListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });

  it("produces a fresh ISO timestamp per call reflecting the current time", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    vi.setSystemTime(new Date("2026-03-15T12:00:05.000Z"));
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    const firstEvent = listener.mock.calls[0][0] as DashboardEvent;
    const secondEvent = listener.mock.calls[1][0] as DashboardEvent;
    expect(firstEvent.timestamp).toBe("2026-03-15T12:00:00.000Z");
    expect(secondEvent.timestamp).toBe("2026-03-15T12:00:05.000Z");
  });
});
