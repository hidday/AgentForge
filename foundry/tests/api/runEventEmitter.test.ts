import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function listen(emitter: RunEventEmitter) {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
    });
    expect(typeof (events[0] as { timestamp: string }).timestamp).toBe("string");
  });

  it("emits a run:artifact-created event", () => {
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

  it("emits a run:created event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/backend");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/backend",
    });
  });

  it("emits a process:started event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

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

  it("emits a process:output event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some output chunk",
    });
  });

  it("emits a process:completed event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1500);

    expect(events[0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1500,
    });
  });

  it("emits a run:questions-answered event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emits a run:chat-reply event", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitChatReply("run-1", "Here's the answer", 250);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here's the answer",
      durationMs: 250,
    });
  });

  it("delivers events to multiple listeners", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/backend");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
