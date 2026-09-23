import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a 'dashboard' event with type run:state-changed and the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "Todo", "Planning");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(() => new Date((event as { timestamp: string }).timestamp)).not.toThrow();
    expect(Number.isNaN(new Date((event as { timestamp: string }).timestamp).getTime())).toBe(false);
  });

  it("emitArtifactCreated emits a 'dashboard' event with type run:artifact-created", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated emits a 'dashboard' event with type run:created", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
    });
  });

  it("emitProcessStarted emits a 'dashboard' event with type process:started", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-1", "proc-1", "planning", "claude-code", "npm run plan");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "npm run plan",
    });
  });

  it("emitProcessOutput emits a 'dashboard' event with type process:output", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "some stdout chunk",
    });
  });

  it("emitProcessCompleted emits a 'dashboard' event with type process:completed", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "planning", "claude-code", 0, 1234);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emitProcessCompleted supports a non-zero exit code", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-1", "proc-1", "execution", "codex", 1, 999);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({ exitCode: 1, durationMs: 999 });
  });

  it("emitQuestionsAnswered emits a 'dashboard' event with type run:questions-answered", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-1", 5);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 5,
    });
  });

  it("emitChatReply emits a 'dashboard' event with type run:chat-reply", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-1", "Here is my reply", 42);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Here is my reply",
      durationMs: 42,
    });
  });

  it("supports multiple listeners on the same 'dashboard' event", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-2", "LIN-2", "another-repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerA.mock.calls[0][0]).toEqual(listenerB.mock.calls[0][0]);
  });

  it("does not notify a listener after it has been removed with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-3", "LIN-3", "yet-another-repo");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify listeners registered on a different event name", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("other-channel", listener);

    emitter.emitRunCreated("run-4", "LIN-4", "repo-4");

    expect(listener).not.toHaveBeenCalled();
  });

  it("emits no event, and throws no error, when there are no listeners registered", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitStateChanged("run-5", "Todo", "Planning")).not.toThrow();
  });

  it("is a real Node EventEmitter instance", () => {
    const emitter = new RunEventEmitter();
    expect(typeof emitter.on).toBe("function");
    expect(typeof emitter.emit).toBe("function");
    expect(typeof emitter.removeListener).toBe("function");
  });
});
