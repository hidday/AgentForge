import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a dashboard event with the run:state-changed shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
    expect(Number.isNaN(new Date((event as { timestamp: string }).timestamp).getTime())).toBe(
      false,
    );
  });

  it("emitArtifactCreated emits a dashboard event with the run:artifact-created shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated emits a dashboard event with the run:created shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-9", "org/repo");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-9",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a dashboard event with the process:started shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
    });
  });

  it("emitProcessOutput emits a dashboard event with the process:output shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "chunk of output text");

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "chunk of output text",
    });
  });

  it("emitProcessCompleted emits a dashboard event with the process:completed shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "codex", 0, 1234);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "codex",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitProcessCompleted propagates a non-zero exit code (failure path)", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6b", "proc-3b", "implementing", "codex", 1, 50);

    expect(listener.mock.calls[0][0]).toMatchObject({ exitCode: 1 });
  });

  it("emitQuestionsAnswered emits a dashboard event with the run:questions-answered shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-7", 2);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
    });
  });

  it("emitChatReply emits a dashboard event with the run:chat-reply shape", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-8", "Here is the answer", 42);

    expect(listener.mock.calls[0][0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 42,
    });
  });

  it("does not notify a listener that has unsubscribed via off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitStateChanged("run-9", "Todo", "Planning");

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies every subscriber registered on the dashboard channel", () => {
    const emitter = new RunEventEmitter();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on("dashboard", first);
    emitter.on("dashboard", second);

    emitter.emitStateChanged("run-10", "Todo", "Planning");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("emits nothing on unrelated event channels", () => {
    const emitter = new RunEventEmitter();
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("other", otherListener);

    emitter.emitRunCreated("run-11", "LIN-1", "org/repo");

    expect(dashboardListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });
});
