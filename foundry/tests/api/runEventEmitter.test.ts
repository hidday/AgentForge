import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a dashboard event with the correct shape", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitStateChanged("run-1", "Planning", "Implementing");

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "Implementing",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
  });

  it("emitArtifactCreated includes artifactType and version", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated includes issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitRunCreated("run-3", "LIN-1", "org/repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-1",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted includes stage, runtime, and command", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude --plan");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude --plan",
    });
  });

  it("emitProcessOutput includes the output chunk", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessOutput("run-5", "proc-2", "partial output line\n");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "partial output line\n",
    });
  });

  it("emitProcessCompleted includes exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-6", "proc-3", "executing", "codex", 0, 4200);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "executing",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4200,
    });
  });

  it("emitProcessCompleted reports a non-zero exitCode for a failed process", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitProcessCompleted("run-7", "proc-4", "executing", "cursor", 1, 100);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect((event as { exitCode: number }).exitCode).toBe(1);
  });

  it("emitQuestionsAnswered includes the questionCount", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitQuestionsAnswered("run-8", 2);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-8",
      questionCount: 2,
    });
  });

  it("emitChatReply includes reply text and durationMs", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);

    emitter.emitChatReply("run-9", "Here is the answer", 777);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-9",
      reply: "Here is the answer",
      durationMs: 777,
    });
  });

  it("supports multiple independent subscribers receiving the same event", () => {
    const emitter = new RunEventEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    emitter.on("dashboard", handlerA);
    emitter.on("dashboard", handlerB);

    emitter.emitStateChanged("run-10", "Todo", "Planning");

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("stops notifying a handler once it has been unsubscribed via off()", () => {
    const emitter = new RunEventEmitter();
    const handler = vi.fn();
    emitter.on("dashboard", handler);
    emitter.off("dashboard", handler);

    emitter.emitStateChanged("run-11", "Todo", "Planning");

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no subscribers", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-12", "LIN-2", "org/repo2")).not.toThrow();
  });
});
