import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged sends a run:state-changed event with from/to and a timestamp", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toEqual({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated sends a run:artifact-created event with type and version", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated sends a run:created event with issueId and repo", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-2", "LIN-42", "org/repo");

    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-2",
      issueId: "LIN-42",
      repo: "org/repo",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted sends a process:started event with stage, runtime and command", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "claude plan");

    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput sends a process:output event carrying the output chunk", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk\n");

    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk\n",
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted sends a process:completed event with exitCode and durationMs", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted carries a non-zero exit code through unchanged", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "implementing", "codex", 1, 999);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ exitCode: 1, durationMs: 999 });
  });

  it("emitQuestionsAnswered sends a run:questions-answered event with the question count", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 4);

    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 4,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("emitChatReply sends a run:chat-reply event with reply text and duration", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here's the answer", 250);

    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here's the answer",
      durationMs: 250,
      timestamp: "2026-03-15T12:00:00.000Z",
    });
  });

  it("fans out a single emit to every subscriber on the dashboard channel", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const listenerC = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);
    emitter.on("dashboard", listenerC);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerC).toHaveBeenCalledTimes(1);
    // All subscribers receive the exact same event payload.
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
    expect(listenerB.mock.calls[0][0]).toEqual(listenerC.mock.calls[0][0]);
  });

  it("stops notifying a subscriber once it is removed (client disconnect)", () => {
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-2", "LIN-2", "repo");

    // Still only the one call from before the removal.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removing one subscriber does not affect other still-connected subscribers", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.off("dashboard", listenerA);
    emitter.emitRunCreated("run-1", "LIN-1", "repo");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a subscriber's handler throws synchronously", () => {
    // Node's EventEmitter propagates a listener's thrown error synchronously
    // to the emit() call; a route that writes to a dead HTTP socket may
    // throw here, and the emitter must not corrupt state for other emits.
    const throwingListener = vi.fn(() => {
      throw new Error("write after end");
    });
    emitter.on("dashboard", throwingListener);

    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "repo")).toThrow("write after end");

    // The emitter itself is still usable afterwards.
    const nextListener = vi.fn();
    emitter.off("dashboard", throwingListener);
    emitter.on("dashboard", nextListener);
    emitter.emitRunCreated("run-2", "LIN-2", "repo");
    expect(nextListener).toHaveBeenCalledTimes(1);
  });

  it("does not emit anything on the dashboard channel when there are no subscribers", () => {
    // No listeners registered; emitting must not throw.
    expect(() => emitter.emitChatReply("run-1", "reply", 10)).not.toThrow();
  });
});
