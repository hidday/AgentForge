import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    handler = vi.fn();
    emitter.on("dashboard", handler);
  });

  it("emitStateChanged emits a run:state-changed event with runId, from, to and an ISO timestamp", () => {
    emitter.emitStateChanged("run-1", "Planning", "AwaitingPlanApproval");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
    });
    expect(typeof (event as { timestamp: string }).timestamp).toBe("string");
    expect(new Date((event as { timestamp: string }).timestamp).toISOString()).toBe(
      (event as { timestamp: string }).timestamp,
    );
  });

  it("emitArtifactCreated emits a run:artifact-created event with artifactType and version", () => {
    emitter.emitArtifactCreated("run-2", "Plan", 3);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:artifact-created",
      runId: "run-2",
      artifactType: "Plan",
      version: 3,
    });
  });

  it("emitRunCreated emits a run:created event with issueId and repo", () => {
    emitter.emitRunCreated("run-3", "LIN-99", "org/repo");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:created",
      runId: "run-3",
      issueId: "LIN-99",
      repo: "org/repo",
    });
  });

  it("emitProcessStarted emits a process:started event with stage, runtime and command", () => {
    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:started",
      runId: "run-4",
      processId: "proc-1",
      stage: "planning",
      runtime: "claude-code",
      command: "claude plan",
    });
  });

  it("emitProcessOutput emits a process:output event with the output chunk", () => {
    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:output",
      runId: "run-5",
      processId: "proc-2",
      chunk: "some stdout chunk",
    });
  });

  it("emitProcessCompleted emits a process:completed event with exitCode and durationMs", () => {
    emitter.emitProcessCompleted("run-6", "proc-3", "implementing", "claude-code", 0, 4321);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "process:completed",
      runId: "run-6",
      processId: "proc-3",
      stage: "implementing",
      runtime: "claude-code",
      exitCode: 0,
      durationMs: 4321,
    });
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with questionCount", () => {
    emitter.emitQuestionsAnswered("run-7", 2);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:questions-answered",
      runId: "run-7",
      questionCount: 2,
    });
  });

  it("emitChatReply emits a run:chat-reply event with reply text and durationMs", () => {
    emitter.emitChatReply("run-8", "Here is the answer", 999);

    const event = handler.mock.calls[0][0] as DashboardEvent;
    expect(event).toMatchObject({
      type: "run:chat-reply",
      runId: "run-8",
      reply: "Here is the answer",
      durationMs: 999,
    });
  });

  it("delivers events to multiple listeners registered on the 'dashboard' channel", () => {
    const second = vi.fn();
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-9", "LIN-1", "repo");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops delivering events to a listener after it is removed with off()", () => {
    emitter.off("dashboard", handler);

    emitter.emitRunCreated("run-10", "LIN-1", "repo");

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not emit on unrelated event channels", () => {
    const other = vi.fn();
    emitter.on("other-channel", other);

    emitter.emitRunCreated("run-11", "LIN-1", "repo");

    expect(other).not.toHaveBeenCalled();
  });
});
