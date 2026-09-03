import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
  });

  it("delivers emitStateChanged to a subscriber with the correct shape", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({ runId: "run-1", from: "Todo", to: "Planning" });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    // Must be a valid, parseable ISO timestamp close to "now".
    const ts = new Date((event as { timestamp: string }).timestamp).getTime();
    expect(Number.isNaN(ts)).toBe(false);
    expect(Math.abs(Date.now() - ts)).toBeLessThan(2000);
  });

  it("delivers emitArtifactCreated with type, version and runId", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("delivers emitRunCreated with issueId and repo", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-9", "org/repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-9",
      repo: "org/repo",
    });
  });

  it("delivers emitProcessStarted with stage, runtime and command", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-4", "proc-1", "plan", "claude-code", "claude --plan");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "plan",
      runtime: "claude-code",
      command: "claude --plan",
    });
  });

  it("delivers emitProcessOutput with the output chunk", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "building...\n");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "building...\n",
    });
  });

  it("delivers emitProcessCompleted with exitCode and durationMs", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "execute", "codex", 0, 12345);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "execute",
      runtime: "codex",
      exitCode: 0,
      durationMs: 12345,
    });
  });

  it("delivers a nonzero exitCode faithfully (does not coerce falsy-looking failure codes)", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-4", "execute", "codex", 1, 500);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect((event as { exitCode: number }).exitCode).toBe(1);
  });

  it("delivers emitQuestionsAnswered with questionCount", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-7", 4);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 4,
    });
  });

  it("delivers emitChatReply with reply text and durationMs", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-8", "Here is the answer.", 777);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer.",
      durationMs: 777,
    });
  });

  it("stops delivering events to a handler after it unsubscribes via off()", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitStateChanged("run-1", "Todo", "Planning");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    // Still only the one call from before unsubscribing.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers a single emitted event to every concurrently subscribed handler", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const handlerC = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);
    emitter.on("dashboard", handlerC);

    emitter.emitRunCreated("run-9", "LIN-1", "org/repo");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerC).toHaveBeenCalledTimes(1);
    // All three handlers received the exact same event payload.
    expect(handlerA.mock.calls[0][0]).toEqual(handlerB.mock.calls[0][0]);
    expect(handlerB.mock.calls[0][0]).toEqual(handlerC.mock.calls[0][0]);
  });

  it("unsubscribing one handler leaves other concurrent subscribers unaffected", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.off("dashboard", handlerA);
    emitter.emitQuestionsAnswered("run-10", 2);

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with zero subscribers", () => {
    expect(emitter.listenerCount("dashboard")).toBe(0);
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
    expect(() => emitter.emitProcessOutput("run-1", "p1", "chunk")).not.toThrow();
  });

  it("emits distinct DashboardEvent objects on each call (no shared mutable state)", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitStateChanged("run-1", "Todo", "Planning");
    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(events).toHaveLength(2);
    expect(events[0]).not.toBe(events[1]);
    expect((events[0] as { to: string }).to).toBe("Planning");
    expect((events[1] as { to: string }).to).toBe("PlanReview");
  });
});
