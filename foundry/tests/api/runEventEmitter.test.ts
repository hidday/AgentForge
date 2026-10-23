import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function collect(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (e: DashboardEvent) => events.push(e));
  return events;
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
    });
    expect(() => new Date((events[0] as { timestamp: string }).timestamp)).not.toThrow();
    expect(Number.isNaN(new Date((events[0] as { timestamp: string }).timestamp).getTime())).toBe(
      false,
    );
  });

  it("emitArtifactCreated emits a run:artifact-created event with artifactType and version", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:artifact-created",
        runId: "run-2",
        artifactType: "Plan",
        version: 3,
      }),
    ]);
  });

  it("emitRunCreated emits a run:created event with issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitRunCreated("run-3", "LIN-42", "org/repo");

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:created",
        runId: "run-3",
        issueId: "LIN-42",
        repo: "org/repo",
      }),
    ]);
  });

  it("emitProcessStarted emits a process:started event with stage, runtime and command", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitProcessStarted("run-4", "proc-1", "executor", "claude-code", "claude --model x");

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:started",
        runId: "run-4",
        processId: "proc-1",
        stage: "executor",
        runtime: "claude-code",
        command: "claude --model x",
      }),
    ]);
  });

  it("emitProcessOutput emits a process:output event with the output chunk", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:output",
        runId: "run-5",
        processId: "proc-2",
        chunk: "some stdout chunk",
      }),
    ]);
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitProcessCompleted("run-6", "proc-3", "executor", "claude-code", 0, 1234);

    expect(events).toEqual([
      expect.objectContaining({
        type: "process:completed",
        runId: "run-6",
        processId: "proc-3",
        stage: "executor",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1234,
      }),
    ]);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitQuestionsAnswered("run-7", 5);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:questions-answered",
        runId: "run-7",
        questionCount: 5,
      }),
    ]);
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    const emitter = new RunEventEmitter();
    const events = collect(emitter);

    emitter.emitChatReply("run-8", "Here is the answer", 777);

    expect(events).toEqual([
      expect.objectContaining({
        type: "run:chat-reply",
        runId: "run-8",
        reply: "Here is the answer",
        durationMs: 777,
      }),
    ]);
  });

  it("delivers events to multiple listeners registered on the same emitter", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-9", "LIN-9", "org/repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-10", "LIN-10", "org/repo");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw and delivers nothing when no listeners are registered", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-11", "LIN-11", "org/repo")).not.toThrow();
  });
});
