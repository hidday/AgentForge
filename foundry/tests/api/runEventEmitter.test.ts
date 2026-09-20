import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function collect(): DashboardEvent[] {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));
    return events;
  }

  it("emitStateChanged emits a run:state-changed event with the run/from/to and an ISO timestamp", () => {
    const events = collect();
    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-05-01T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const events = collect();
    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(events).toEqual([
      {
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "Plan",
        version: 2,
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitRunCreated emits a run:created event", () => {
    const events = collect();
    emitter.emitRunCreated("run-1", "LIN-42", "acme/repo");

    expect(events).toEqual([
      {
        type: "run:created",
        runId: "run-1",
        issueId: "LIN-42",
        repo: "acme/repo",
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessStarted emits a process:started event", () => {
    const events = collect();
    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude", "claude --print");

    expect(events).toEqual([
      {
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude",
        command: "claude --print",
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessOutput emits a process:output event with the raw chunk", () => {
    const events = collect();
    emitter.emitProcessOutput("run-1", "proc-1", "stdout chunk");

    expect(events).toEqual([
      {
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "stdout chunk",
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessCompleted emits a process:completed event with exit code and duration", () => {
    const events = collect();
    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude", 0, 4500);

    expect(events).toEqual([
      {
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude",
        exitCode: 0,
        durationMs: 4500,
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event", () => {
    const events = collect();
    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events).toEqual([
      {
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 3,
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("emitChatReply emits a run:chat-reply event with reply text and duration", () => {
    const events = collect();
    emitter.emitChatReply("run-1", "Here is the answer.", 1200);

    expect(events).toEqual([
      {
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is the answer.",
        durationMs: 1200,
        timestamp: "2026-05-01T12:00:00.000Z",
      },
    ]);
  });

  it("fans out a single emitted event to multiple subscribers", () => {
    const received1: DashboardEvent[] = [];
    const received2: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => received1.push(e));
    emitter.on("dashboard", (e: DashboardEvent) => received2.push(e));

    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    expect(received1[0]).toEqual(received2[0]);
  });

  it("stops delivering events to a listener after it unsubscribes with off", () => {
    const received: DashboardEvent[] = [];
    const handler = (e: DashboardEvent) => received.push(e);
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    expect(received).toHaveLength(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-2", "LIN-2", "acme/repo");

    expect(received).toHaveLength(1);
  });

  it("does not throw when emitting with no subscribers at all", () => {
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "acme/repo")).not.toThrow();
  });

  it("does not throw when emitting after every subscriber has unsubscribed", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.off("dashboard", handlerA);
    emitter.off("dashboard", handlerB);

    expect(() => emitter.emitChatReply("run-1", "reply", 100)).not.toThrow();
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it("only notifies a listener registered under a different event name for its own name", () => {
    const dashboardHandler = vi.fn();
    const otherHandler = vi.fn();
    emitter.on("dashboard", dashboardHandler);
    emitter.on("other-channel", otherHandler);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(dashboardHandler).toHaveBeenCalledTimes(1);
    expect(otherHandler).not.toHaveBeenCalled();
  });
});
