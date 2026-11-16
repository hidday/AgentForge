import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

function expectValidTimestamp(event: DashboardEvent) {
  expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "planning", "executing");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "planning",
      to: "executing",
    });
    expectValidTimestamp(event);
  });

  it("emitArtifactCreated emits a run:artifact-created event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
    expectValidTimestamp(event);
  });

  it("emitRunCreated emits a run:created event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitRunCreated("run-3", "issue-9", "org/repo");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "issue-9",
      repo: "org/repo",
    });
    expectValidTimestamp(event);
  });

  it("emitProcessStarted emits a process:started event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessStarted("run-4", "proc-1", "planner", "claude-code", "claude --version");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude --version",
    });
    expectValidTimestamp(event);
  });

  it("emitProcessOutput emits a process:output event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessOutput("run-5", "proc-2", "some output chunk");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some output chunk",
    });
    expectValidTimestamp(event);
  });

  it("emitProcessCompleted emits a process:completed event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitProcessCompleted("run-6", "proc-3", "executor", "codex", 0, 4321);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "executor",
      runtime: "codex",
      exitCode: 0,
      durationMs: 4321,
    });
    expectValidTimestamp(event);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitQuestionsAnswered("run-7", 5);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 5,
    });
    expectValidTimestamp(event);
  });

  it("emitChatReply emits a run:chat-reply event with the given fields", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitChatReply("run-8", "Looks good to me.", 987);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Looks good to me.",
      durationMs: 987,
    });
    expectValidTimestamp(event);
  });

  it("does not emit on the dashboard channel if no event method is called", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    expect(listener).not.toHaveBeenCalled();
  });
});
