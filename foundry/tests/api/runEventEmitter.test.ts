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

  function captured(emitter: RunEventEmitter): DashboardEvent[] {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));
    return events;
  }

  it("is an EventEmitter that only fires listeners for the emitted event name", () => {
    const emitter = new RunEventEmitter();
    const dashboardHandler = vi.fn();
    const otherHandler = vi.fn();
    emitter.on("dashboard", dashboardHandler);
    emitter.on("other", otherHandler);

    emitter.emitRunCreated("run-1", "issue-1", "repo-1");

    expect(dashboardHandler).toHaveBeenCalledTimes(1);
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it("emitStateChanged emits a run:state-changed event with the transition and timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(events).toEqual([
      {
        type: "run:state-changed",
        runId: "run-1",
        from: "Todo",
        to: "Planning",
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitArtifactCreated emits a run:artifact-created event with type and version", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(events).toEqual([
      {
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "Plan",
        version: 3,
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitRunCreated emits a run:created event with issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitRunCreated("run-1", "LIN-42", "org/repo");

    expect(events).toEqual([
      {
        type: "run:created",
        runId: "run-1",
        issueId: "LIN-42",
        repo: "org/repo",
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessStarted emits a process:started event with stage, runtime and command", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(events).toEqual([
      {
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude-code",
        command: "claude plan",
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessOutput emits a process:output event with the output chunk", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(events).toEqual([
      {
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "some stdout chunk",
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(events).toEqual([
      {
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1234,
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitProcessCompleted reflects a non-zero exit code", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "implementing", "codex", 1, 42);

    expect((events[0] as { exitCode: number }).exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the count", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events).toEqual([
      {
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 3,
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("emitChatReply emits a run:chat-reply event with reply text and duration", () => {
    const emitter = new RunEventEmitter();
    const events = captured(emitter);

    emitter.emitChatReply("run-1", "Here is the answer", 777);

    expect(events).toEqual([
      {
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is the answer",
        durationMs: 777,
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ]);
  });

  it("supports multiple listeners and multiple emissions independently", () => {
    const emitter = new RunEventEmitter();
    const first: DashboardEvent[] = [];
    const second: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => first.push(e));
    emitter.on("dashboard", (e: DashboardEvent) => second.push(e));

    emitter.emitRunCreated("run-1", "issue-1", "repo-1");
    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });

  it("off() stops a listener from receiving further events", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitRunCreated("run-1", "issue-1", "repo-1");
    expect(handler).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-1", "issue-1", "repo-1");

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
