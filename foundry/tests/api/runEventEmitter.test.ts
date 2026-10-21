import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a run:state-changed event with an ISO timestamp on the 'dashboard' channel", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a run:artifact-created event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a run:created event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/widgets",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a process:started event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "Executing", "claude-code", "claude run");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "Executing",
      runtime: "claude-code",
      command: "claude run",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a process:output event carrying the raw chunk", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "stdout line\n");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "stdout line\n",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a process:completed event with exit code and duration", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "Executing", "claude-code", 0, 4321);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "Executing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4321,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a non-zero exit code faithfully (failure case)", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "Executing", "claude-code", 1, 10);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 1 }));
  });

  it("emits a run:questions-answered event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emits a run:chat-reply event", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here's the answer", 1500);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here's the answer",
      durationMs: 1500,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("delivers a single emitted event to every subscriber", () => {
    const first = vi.fn();
    const second = vi.fn();
    emitter.on("dashboard", first);
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no subscribers", () => {
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets")).not.toThrow();
  });

  it("narrows DashboardEvent by discriminant 'type' (compile-time contract check)", () => {
    const event: DashboardEvent = {
      type: "run:chat-reply",
      runId: "run-1",
      reply: "ok",
      durationMs: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    if (event.type === "run:chat-reply") {
      expect(event.reply).toBe("ok");
    }
  });
});
