import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;
  let listener: ReturnType<typeof vi.fn<[DashboardEvent], void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    emitter = new RunEventEmitter();
    listener = vi.fn();
    emitter.on("dashboard", listener);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emitStateChanged emits a run:state-changed event with a timestamp", () => {
    emitter.emitStateChanged("run-1", "planning", "executing");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: "run:state-changed",
      runId: "run-1",
      from: "planning",
      to: "executing",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    emitter.emitArtifactCreated("run-1", "plan", 3);
    expect(listener).toHaveBeenCalledWith({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "plan",
      version: 3,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    emitter.emitRunCreated("run-1", "issue-42", "org/repo");
    expect(listener).toHaveBeenCalledWith({
      type: "run:created",
      runId: "run-1",
      issueId: "issue-42",
      repo: "org/repo",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessStarted emits a process:started event", () => {
    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude");
    expect(listener).toHaveBeenCalledWith({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessOutput emits a process:output event", () => {
    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");
    expect(listener).toHaveBeenCalledWith({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output chunk",
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitProcessCompleted emits a process:completed event", () => {
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "codex", 0, 1234);
    expect(listener).toHaveBeenCalledWith({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "codex",
      exitCode: 0,
      durationMs: 1234,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event", () => {
    emitter.emitQuestionsAnswered("run-1", 5);
    expect(listener).toHaveBeenCalledWith({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 5,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("emitChatReply emits a run:chat-reply event", () => {
    emitter.emitChatReply("run-1", "here's the answer", 42);
    expect(listener).toHaveBeenCalledWith({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "here's the answer",
      durationMs: 42,
      timestamp: "2026-01-15T12:00:00.000Z",
    });
  });

  it("supports multiple independent listeners on the dashboard channel", () => {
    const second = vi.fn();
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-2", "issue-9", "org/other");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run:created", runId: "run-2" }),
    );
  });

  it("does not throw when no listeners are registered", () => {
    const bare = new RunEventEmitter();
    expect(() => bare.emitRunCreated("run-3", "issue-1", "org/repo")).not.toThrow();
  });
});
