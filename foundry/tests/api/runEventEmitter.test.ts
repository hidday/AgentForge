import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is an EventEmitter that broadcasts on the 'dashboard' channel", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.emitStateChanged("run-1", "Todo", "Planning");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event with artifactType and version", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(events[0]).toEqual({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event with issueId and repo", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitRunCreated("run-1", "LIN-42", "acme/widgets");

    expect(events[0]).toEqual({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-42",
      repo: "acme/widgets",
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with stage/runtime/command", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(events[0]).toEqual({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event carrying the output chunk", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk\n");

    expect(events[0]).toEqual({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk\n",
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitProcessCompleted("run-1", "proc-1", "execution", "codex", 0, 4321);

    expect(events[0]).toEqual({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "execution",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4321,
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted correctly reports a non-zero exit code", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitProcessCompleted("run-1", "proc-1", "execution", "codex", 1, 999);

    expect((events[0] as { exitCode: number }).exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toEqual({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    const events: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => events.push(e));

    emitter.emitChatReply("run-1", "Here is the answer", 250);

    expect(events[0]).toEqual({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 250,
      timestamp: "2026-09-04T12:00:00.000Z",
    });
  });

  it("supports multiple independent listeners receiving the same event", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitRunCreated("run-2", "LIN-99", "acme/other");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("stops delivering to a listener after it is removed with off()", () => {
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.off("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-7", "acme/third");

    expect(handler).not.toHaveBeenCalled();
  });
});
