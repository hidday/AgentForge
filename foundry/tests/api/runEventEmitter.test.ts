import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useRealTimers();
  });

  it("does nothing (no throw) when a method is called with no subscribers", () => {
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });

  it("emitStateChanged notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp).toISOString()).not.toThrow();
  });

  it("emitArtifactCreated notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
    });
  });

  it("emitProcessStarted notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
    });
  });

  it("emitProcessOutput notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output chunk",
    });
  });

  it("emitProcessOutput handles empty-string chunks", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-1", "proc-1", "");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect((event as { chunk: string }).chunk).toBe("");
  });

  it("emitProcessCompleted notifies subscribers with the correct shape, including zero exit code", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1500);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
    });
  });

  it("emitProcessCompleted preserves a non-zero exit code", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 1, 42);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect((event as { exitCode: number }).exitCode).toBe(1);
  });

  it("emitQuestionsAnswered notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-1", 4);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 4,
    });
  });

  it("emitChatReply notifies subscribers with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-1", "Here is my answer", 750);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is my answer",
      durationMs: 750,
    });
  });

  it("notifies multiple subscribers on the same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on("dashboard", handler1);
    emitter.on("dashboard", handler2);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    // Both subscribers should have received the exact same event payload.
    expect(handler1.mock.calls[0][0]).toEqual(handler2.mock.calls[0][0]);
  });

  it("stops notifying a handler after it unsubscribes via off()", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    // Still just one call — the second emission was not delivered.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports a handler unsubscribing itself mid-broadcast without breaking other subscribers", () => {
    const calls: string[] = [];
    const selfUnsub = vi.fn(() => {
      calls.push("self");
      emitter.off("dashboard", selfUnsub);
    });
    const other = vi.fn(() => {
      calls.push("other");
    });

    emitter.on("dashboard", selfUnsub);
    emitter.on("dashboard", other);

    // First emission: both handlers run; selfUnsub removes itself afterward.
    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(calls).toEqual(["self", "other"]);

    // Second emission: only `other` should still be subscribed.
    calls.length = 0;
    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(calls).toEqual(["other"]);
    expect(selfUnsub).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it("produces monotonically-parseable ISO timestamps across successive emissions", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Todo", "Planning");
    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    const [first, second] = handler.mock.calls.map(
      (c) => new Date((c[0] as { timestamp: string }).timestamp).getTime(),
    );
    expect(Number.isNaN(first)).toBe(false);
    expect(Number.isNaN(second)).toBe(false);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("is a Node EventEmitter instance exposing on/off/emit", () => {
    expect(typeof emitter.on).toBe("function");
    expect(typeof emitter.off).toBe("function");
    expect(typeof emitter.emit).toBe("function");
  });
});
