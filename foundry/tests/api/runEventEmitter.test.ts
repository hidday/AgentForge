import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function captureDashboardEvents(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event with the given fields and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitStateChanged("run-1", "planning", "executing");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "planning",
      to: "executing",
    });
    expect(() => new Date((events[0] as { timestamp: string }).timestamp)).not.toThrow();
    expect(new Date((events[0] as { timestamp: string }).timestamp).toISOString()).toBe(
      (events[0] as { timestamp: string }).timestamp,
    );
  });

  it("emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitArtifactCreated("run-1", "plan", 2);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "plan",
        version: 2,
      }),
    ]);
  });

  it("emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitRunCreated("run-2", "ISSUE-9", "org/repo");

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:created",
        runId: "run-2",
        issueId: "ISSUE-9",
        repo: "org/repo",
      }),
    ]);
  });

  it("emits a process:started event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude --version");

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "planner",
        runtime: "claude-code",
        command: "claude --version",
      }),
    ]);
  });

  it("emits a process:output event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "some output chunk",
      }),
    ]);
  });

  it("emits a process:completed event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1234);

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "executor",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1234,
      }),
    ]);
  });

  it("emits a run:questions-answered event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 3,
      }),
    ]);
  });

  it("emits a run:chat-reply event", () => {
    const emitter = new RunEventEmitter();
    const events = captureDashboardEvents(emitter);

    emitter.emitChatReply("run-1", "Here is the answer.", 500);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is the answer.",
        durationMs: 500,
      }),
    ]);
  });

  it("delivers events to multiple listeners and supports unsubscribing", () => {
    const emitter = new RunEventEmitter();
    const first = vi.fn();
    const second = vi.fn();

    emitter.on("dashboard", first);
    emitter.on("dashboard", second);
    emitter.emitRunCreated("run-3", "ISSUE-1", "org/repo");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", second);
    emitter.emitRunCreated("run-4", "ISSUE-2", "org/repo");

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitted with no listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-5", "a", "b")).not.toThrow();
  });
});
