import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function listen(emitter: RunEventEmitter) {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (e: DashboardEvent) => events.push(e));
  return events;
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitStateChanged("run-1", "planning", "executing");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "planning",
      to: "executing",
    });
    expect(new Date((events[0] as { timestamp: string }).timestamp).toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(events[0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitRunCreated("run-1", "issue-1", "org/repo");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "issue-1",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a process:started event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "claude");

    expect(events[0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "claude",
    });
  });

  it("emitProcessOutput emits a process:output event carrying the chunk", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitProcessOutput("run-1", "proc-1", "partial output");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "partial output",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exit code and duration", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1234);

    expect(events[0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a run:chat-reply event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);
    emitter.emitChatReply("run-1", "the answer", 500);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "the answer",
      durationMs: 500,
    });
  });

  it("delivers events to multiple listeners independently", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-2", "issue-2", "org/repo2");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("stops delivering to a listener once it is removed", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-3", "issue-3", "org/repo3");

    expect(listener).not.toHaveBeenCalled();
  });
});
