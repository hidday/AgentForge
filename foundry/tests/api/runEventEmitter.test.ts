import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged() emits a 'dashboard' event with the state transition payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({ runId: "run-1", from: "Planning", to: "PlanReview" });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(new Date((event as { timestamp: string }).timestamp).toString()).not.toBe("Invalid Date");
  });

  it("emitArtifactCreated() emits the artifact-created payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 2);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ type: "run:artifact-created", runId: "run-1", artifactType: "Plan", version: 2 });
  });

  it("emitRunCreated() emits the run-created payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ type: "run:created", runId: "run-1", issueId: "LIN-1", repo: "test-repo" });
  });

  it("emitProcessStarted() emits the process:started payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "npm test");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "npm test",
    });
  });

  it("emitProcessOutput() emits the process:output payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ type: "process:output", runId: "run-1", processId: "proc-1", chunk: "some output chunk" });
  });

  it("emitProcessCompleted() emits the process:completed payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 4200);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4200,
    });
  });

  it("emitQuestionsAnswered() emits the questions-answered payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 3);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ type: "run:questions-answered", runId: "run-1", questionCount: 3 });
  });

  it("emitChatReply() emits the chat-reply payload", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is the answer.", 1500);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is the answer.",
      durationMs: 1500,
    });
  });

  it("does not emit anything when there are no listeners (no throw)", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-1", "Todo", "Planning")).not.toThrow();
  });

  it("supports multiple independent listeners on the same 'dashboard' event", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-2", "LIN-2", "repo-2");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
