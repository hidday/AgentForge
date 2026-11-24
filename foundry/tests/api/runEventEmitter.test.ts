import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function captureEvents(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event with from/to", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
    });
  });

  it("emits a run:artifact-created event", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

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
    const events = captureEvents(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
    });
  });

  it("emits process:started, process:output, and process:completed events", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "claude --print");
    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1234);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "process:started", command: "claude --print" });
    expect(events[1]).toMatchObject({ type: "process:output", chunk: "some output chunk" });
    expect(events[2]).toMatchObject({
      type: "process:completed",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emits a run:questions-answered event", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({ type: "run:questions-answered", questionCount: 3 });
  });

  it("emits a run:chat-reply event", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

    emitter.emitChatReply("run-1", "Here is the answer", 500);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      reply: "Here is the answer",
      durationMs: 500,
    });
  });

  it("includes an ISO timestamp on every emitted event", () => {
    const emitter = new RunEventEmitter();
    const events = captureEvents(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(events[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("extends EventEmitter and supports multiple listeners", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
