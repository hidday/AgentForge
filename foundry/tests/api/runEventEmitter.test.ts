import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function listen(): DashboardEvent[] {
    const received: DashboardEvent[] = [];
    emitter.on("dashboard", (event: DashboardEvent) => received.push(event));
    return received;
  }

  it("emitStateChanged emits a run:state-changed event with the correct payload", () => {
    const received = listen();

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(received).toEqual([
      {
        type: "run:state-changed",
        runId: "run-1",
        from: "Todo",
        to: "Planning",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitArtifactCreated emits a run:artifact-created event with the correct payload", () => {
    const received = listen();

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(received).toEqual([
      {
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "Plan",
        version: 3,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitRunCreated emits a run:created event with the correct payload", () => {
    const received = listen();

    emitter.emitRunCreated("run-1", "issue-1", "org/repo");

    expect(received).toEqual([
      {
        type: "run:created",
        runId: "run-1",
        issueId: "issue-1",
        repo: "org/repo",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitProcessStarted emits a process:started event with the correct payload", () => {
    const received = listen();

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(received).toEqual([
      {
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude-code",
        command: "claude plan",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitProcessOutput emits a process:output event with the correct payload", () => {
    const received = listen();

    emitter.emitProcessOutput("run-1", "proc-1", "some log chunk");

    expect(received).toEqual([
      {
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "some log chunk",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitProcessCompleted emits a process:completed event with the correct payload", () => {
    const received = listen();

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(received).toEqual([
      {
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "planning",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1234,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the correct payload", () => {
    const received = listen();

    emitter.emitQuestionsAnswered("run-1", 2);

    expect(received).toEqual([
      {
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 2,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("emitChatReply emits a run:chat-reply event with the correct payload", () => {
    const received = listen();

    emitter.emitChatReply("run-1", "Here is the answer", 500);

    expect(received).toEqual([
      {
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is the answer",
        durationMs: 500,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("delivers every emitted event to multiple listeners registered on 'dashboard'", () => {
    const receivedA: DashboardEvent[] = [];
    const receivedB: DashboardEvent[] = [];
    emitter.on("dashboard", (event: DashboardEvent) => receivedA.push(event));
    emitter.on("dashboard", (event: DashboardEvent) => receivedB.push(event));

    emitter.emitRunCreated("run-1", "issue-1", "org/repo");

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedA[0]).toEqual(receivedB[0]);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const received: DashboardEvent[] = [];
    const handler = (event: DashboardEvent) => received.push(event);
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-1", "issue-1", "org/repo");
    emitter.off("dashboard", handler);
    emitter.emitRunCreated("run-2", "issue-2", "org/repo");

    expect(received).toHaveLength(1);
    expect((received[0] as { runId: string }).runId).toBe("run-1");
  });

  it("does not emit on unrelated event names", () => {
    const received: unknown[] = [];
    emitter.on("something-else", (event: unknown) => received.push(event));

    emitter.emitRunCreated("run-1", "issue-1", "org/repo");

    expect(received).toHaveLength(0);
  });
});
