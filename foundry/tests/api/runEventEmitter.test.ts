import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function capture(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (event: DashboardEvent) => events.push(event));
  return events;
}

describe("RunEventEmitter", () => {
  it("emits a run:state-changed event with from/to and an ISO timestamp", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
    });
    expect(new Date((events[0] as { timestamp: string }).timestamp).toISOString()).toBe(
      (events[0] as { timestamp: string }).timestamp,
    );
  });

  it("emits a run:artifact-created event with artifact type and version", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitArtifactCreated("run-1", "Plan", 3);

    expect(events[0]).toMatchObject({
      type: "run:artifact-created",
      runId: "run-1",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emits a run:created event with issueId and repo", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitRunCreated("run-2", "LIN-9", "org/repo");

    expect(events[0]).toMatchObject({
      type: "run:created",
      runId: "run-2",
      issueId: "LIN-9",
      repo: "org/repo",
    });
  });

  it("emits a process:started event with stage, runtime, and command", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "npm test");

    expect(events[0]).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "claude-code",
      command: "npm test",
    });
  });

  it("emits a process:output event carrying the output chunk", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitProcessOutput("run-1", "proc-1", "building...\n");

    expect(events[0]).toMatchObject({
      type: "process:output",
      runId: "run-1",
      processId: "proc-1",
      chunk: "building...\n",
    });
  });

  it("emits a process:completed event with exit code and duration", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "codex", 0, 1234);

    expect(events[0]).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId: "proc-1",
      stage: "executor",
      runtime: "codex",
      exitCode: 0,
      durationMs: 1234,
    });
  });

  it("emits a run:questions-answered event with the question count", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitQuestionsAnswered("run-1", 2);

    expect(events[0]).toMatchObject({
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 2,
    });
  });

  it("emits a run:chat-reply event with reply text and duration", () => {
    const emitter = new RunEventEmitter();
    const events = capture(emitter);
    emitter.emitChatReply("run-1", "Done!", 500);

    expect(events[0]).toMatchObject({
      type: "run:chat-reply",
      runId: "run-1",
      reply: "Done!",
      durationMs: 500,
    });
  });

  it("delivers events to multiple listeners registered on the same 'dashboard' channel", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.emitRunCreated("run-3", "LIN-1", "repo");

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.off("dashboard", listener);

    emitter.emitRunCreated("run-4", "LIN-2", "repo");

    expect(listener).not.toHaveBeenCalled();
  });
});
