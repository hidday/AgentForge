import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function listen(emitter: RunEventEmitter) {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "Implementing",
    });
    expect(new Date((events[0] as { timestamp: string }).timestamp).toISOString()).toBe(
      (events[0] as { timestamp: string }).timestamp,
    );
  });

  it("emits a run:artifact-created event with the artifact type and version", () => {
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

  it("emits a run:created event with issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitRunCreated("run-1", "LIN-42", "acme/widgets");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-42",
      repo: "acme/widgets",
    });
  });

  it("emits a process:started event with stage, runtime, and command", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "Implementing", "claude-code", "claude run");

    expect(events[0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "claude-code",
      command: "claude run",
    });
  });

  it("emits a process:output event carrying the output chunk", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
    });
  });

  it("emits a process:completed event with exit code and duration", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "Implementing", "codex", 0, 1234);

    expect(events[0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "Implementing",
      runtime: "codex",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emits a run:questions-answered event with the question count", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emits a run:chat-reply event with the reply text and duration", () => {
    const emitter = new RunEventEmitter();
    const events = listen(emitter);

    emitter.emitChatReply("run-1", "Here is my answer.", 500);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is my answer.",
      durationMs: 500,
    });
  });

  it("delivers a single emitted event to every subscribed listener", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when no listeners are registered", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "acme/widgets")).not.toThrow();
  });
});
