import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-1", "org/repo");

    expect(handler.mock.calls[0][0]).toEqual({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "npm test");

    expect(handler.mock.calls[0][0]).toEqual({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "npm test",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "some log chunk");

    expect(handler.mock.calls[0][0]).toEqual({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some log chunk",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "claude-code", 0, 1234);

    expect(handler.mock.calls[0][0]).toEqual({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-7", 2);

    expect(handler.mock.calls[0][0]).toEqual({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-8", "Here is my answer", 456);

    expect(handler.mock.calls[0][0]).toEqual({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is my answer",
      durationMs: 456,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("does not notify handlers unsubscribed via off", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.off("dashboard", handler);

    emitter.emitRunCreated("run-9", "LIN-2", "org/repo2");

    expect(handler).not.toHaveBeenCalled();
  });
});
