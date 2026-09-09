import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    emitter = new RunEventEmitter();
    handler = vi.fn();
    emitter.on("dashboard", handler);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed event with from/to/timestamp", () => {
    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    emitter.emitRunCreated("run-3", "LIN-9", "org/repo");

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-9",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event", () => {
    emitter.emitProcessStarted("run-4", "proc-1", "planner", "claude-code", "claude --print");

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --print",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event", () => {
    emitter.emitProcessOutput("run-5", "proc-2", "hello chunk");

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "hello chunk",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event", () => {
    emitter.emitProcessCompleted("run-6", "proc-3", "executor", "claude-code", 0, 1500);

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event", () => {
    emitter.emitQuestionsAnswered("run-7", 2);

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event", () => {
    emitter.emitChatReply("run-8", "hi there", 250);

    const event = handler.mock.calls[0]![0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "hi there",
      durationMs: 250,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("supports multiple listeners and off() removing a listener", () => {
    const second = vi.fn();
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-9", "LIN-1", "repo");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", second);
    emitter.emitRunCreated("run-10", "LIN-2", "repo");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not throw and no listeners are called when nothing is subscribed", () => {
    const freshEmitter = new RunEventEmitter();
    expect(() => freshEmitter.emitRunCreated("run-x", "LIN-x", "repo-x")).not.toThrow();
  });
});
