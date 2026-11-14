import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function listen(emitter: RunEventEmitter) {
  const handler = vi.fn<(event: DashboardEvent) => void>();
  emitter.on("dashboard", handler);
  return handler;
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event).toMatchObject({ type: "run:state-changed", runId: "run-1", from: "Todo", to: "Planning" });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
  });

  it("emitArtifactCreated emits a run:artifact-created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 2,
    });
  });

  it("emitRunCreated emits a run:created dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitRunCreated("run-1", "issue-1", "agentforge");

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "issue-1",
      repo: "agentforge",
    });
  });

  it("emitProcessStarted emits a process:started dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "planner", "claude-code", "claude --print");

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --print",
    });
  });

  it("emitProcessOutput emits a process:output dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "a chunk of output");

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "a chunk of output",
    });
  });

  it("emitProcessCompleted emits a process:completed dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "planner", "claude-code", 0, 1234);

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "process:completed",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 3,
    });
  });

  it("emitChatReply emits a run:chat-reply dashboard event", () => {
    const emitter = new RunEventEmitter();
    const handler = listen(emitter);

    emitter.emitChatReply("run-1", "here's the answer", 500);

    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "here's the answer",
      durationMs: 500,
    });
  });

  it("supports multiple independent listeners on the same dashboard event", () => {
    const emitter = new RunEventEmitter();
    const first = listen(emitter);
    const second = listen(emitter);

    emitter.emitRunCreated("run-1", "issue-1", "agentforge");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
