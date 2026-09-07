import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function capture(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with from/to and a timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(typeof (events[0] as { timestamp: string }).timestamp).toBe("string");
  });

  it("emitArtifactCreated emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

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
    const events = capture(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/repo",
    });
  });

  it("emitProcessStarted emits a process:started event", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude");

    expect(events[0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude",
    });
  });

  it("emitProcessOutput emits a process:output event with the raw chunk", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exit code and duration", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

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
    const events = capture(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a run:chat-reply event", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);

    emitter.emitChatReply("run-1", "The plan looks good", 456);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "The plan looks good",
      durationMs: 456,
    });
  });

  it("delivers events to multiple listeners registered on 'dashboard'", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("does not throw when emitting with no listeners attached", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "acme/repo")).not.toThrow();
  });
});
