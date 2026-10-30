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

  function captureOnce(): Promise<DashboardEvent> {
    return new Promise((resolve) => {
      emitter.once("dashboard", resolve);
    });
  }

  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", async () => {
    const promise = captureOnce();
    emitter.emitStateChanged("run-1", "Planning", "PlanReview");
    const event = await promise;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", async () => {
    const promise = captureOnce();
    emitter.emitArtifactCreated("run-1", "Plan", 2);
    const event = await promise;
    expect(event).toEqual({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event with issueId and repo", async () => {
    const promise = captureOnce();
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    const event = await promise;
    expect(event).toEqual({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event with stage/runtime/command", async () => {
    const promise = captureOnce();
    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "claude -p");
    const event = await promise;
    expect(event).toEqual({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "claude -p",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event with the chunk", async () => {
    const promise = captureOnce();
    emitter.emitProcessOutput("run-1", "proc-1", "some output\n");
    const event = await promise;
    expect(event).toEqual({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output\n",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", async () => {
    const promise = captureOnce();
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1500);
    const event = await promise;
    expect(event).toEqual({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", async () => {
    const promise = captureOnce();
    emitter.emitQuestionsAnswered("run-1", 3);
    const event = await promise;
    expect(event).toEqual({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply and durationMs", async () => {
    const promise = captureOnce();
    emitter.emitChatReply("run-1", "Here is the answer", 850);
    const event = await promise;
    expect(event).toEqual({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 850,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("supports multiple listeners on the same 'dashboard' event", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
  });

  it("stops notifying a listener after it is removed with off()", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).not.toHaveBeenCalled();
  });
});
