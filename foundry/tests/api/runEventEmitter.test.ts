import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function listen(emitter: RunEventEmitter) {
  const events: DashboardEvent[] = [];
  const handler = vi.fn((e: DashboardEvent) => events.push(e));
  emitter.on("dashboard", handler);
  return { events, handler };
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(new Date((events[0] as { timestamp: string }).timestamp).toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("emitArtifactCreated emits a run:artifact-created event with artifactType and version", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(events[0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated emits a run:created event with issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a process:started event with stage/runtime/command", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

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

  it("emitProcessOutput emits a process:output event carrying the raw chunk", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1234);

    expect(events[0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    const emitter = new RunEventEmitter();
    const { events } = listen(emitter);

    emitter.emitChatReply("run-1", "Here is the answer", 500);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer",
      durationMs: 500,
    });
  });

  it("delivers events to multiple independent listeners", () => {
    const emitter = new RunEventEmitter();
    const a = listen(emitter);
    const b = listen(emitter);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(a.handler).toHaveBeenCalledOnce();
    expect(b.handler).toHaveBeenCalledOnce();
  });

  it("stops delivering events to a listener after .off() is called", () => {
    const emitter = new RunEventEmitter();
    const { events, handler } = listen(emitter);
    emitter.off("dashboard", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(events).toHaveLength(0);
  });

  it("emits nothing to listeners on unrelated event names", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("other-channel", handler);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(handler).not.toHaveBeenCalled();
  });
});
