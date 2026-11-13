import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function captureOne(): { events: DashboardEvent[] } {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
    return { events };
  }

  it("emitStateChanged emits a run:state-changed event with from/to/timestamp", () => {
    const { events } = captureOne();
    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const { events } = captureOne();
    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    const { events } = captureOne();
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/repo",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with all fields", () => {
    const { events } = captureOne();
    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event with the chunk", () => {
    const { events } = captureOne();
    emitter.emitProcessOutput("run-1", "proc-1", "partial output chunk");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "partial output chunk",
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const { events } = captureOne();
    emitter.emitProcessCompleted("run-1", "proc-1", "execution", "claude-code", 0, 4200);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "execution",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4200,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitProcessCompleted preserves a non-zero exit code (failure case)", () => {
    const { events } = captureOne();
    emitter.emitProcessCompleted("run-1", "proc-1", "execution", "codex", 1, 100);

    expect((events[0] as { exitCode: number }).exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the count", () => {
    const { events } = captureOne();
    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    const { events } = captureOne();
    emitter.emitChatReply("run-1", "Here is the answer.", 850);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer.",
      durationMs: 850,
      timestamp: "2026-01-15T10:00:00.000Z",
    });
  });

  it("delivers events to multiple listeners on the same 'dashboard' channel", () => {
    const received1: DashboardEvent[] = [];
    const received2: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => received1.push(e));
    emitter.on("dashboard", (e: DashboardEvent) => received2.push(e));

    emitter.emitRunCreated("run-2", "LIN-2", "acme/repo2");

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const received: DashboardEvent[] = [];
    const handler = (e: DashboardEvent) => received.push(e);
    emitter.on("dashboard", handler);
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    expect(received).toHaveLength(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    expect(received).toHaveLength(1);
  });

  it("does not emit on unrelated event channels", () => {
    const received: DashboardEvent[] = [];
    emitter.on("something-else", (e: DashboardEvent) => received.push(e));
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    expect(received).toHaveLength(0);
  });
});
