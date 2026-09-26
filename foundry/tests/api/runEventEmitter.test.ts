import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

function isValidIsoTimestamp(value: string): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

describe("RunEventEmitter", () => {
  let emitter: RunEventEmitter;
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitter = new RunEventEmitter();
    listener = vi.fn();
    emitter.on("dashboard", listener);
  });

  it("emitStateChanged emits a run:state-changed event with expected fields", () => {
    emitter.emitStateChanged("run-1", "Planning", "PlanReview");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
    if (event.type !== "run:state-changed") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.from).toBe("Planning");
    expect(event.to).toBe("PlanReview");
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitArtifactCreated emits a run:artifact-created event with expected fields", () => {
    emitter.emitArtifactCreated("run-2", "Plan", 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:artifact-created");
    if (event.type !== "run:artifact-created") throw new Error("wrong type");
    expect(event.runId).toBe("run-2");
    expect(event.artifactType).toBe("Plan");
    expect(event.version).toBe(3);
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitRunCreated emits a run:created event with expected fields", () => {
    emitter.emitRunCreated("run-3", "LIN-42", "org/repo");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:created");
    if (event.type !== "run:created") throw new Error("wrong type");
    expect(event.runId).toBe("run-3");
    expect(event.issueId).toBe("LIN-42");
    expect(event.repo).toBe("org/repo");
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitProcessStarted emits a process:started event with expected fields", () => {
    emitter.emitProcessStarted("run-4", "proc-1", "planning", "claude-code", "claude plan");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("process:started");
    if (event.type !== "process:started") throw new Error("wrong type");
    expect(event.runId).toBe("run-4");
    expect(event.processId).toBe("proc-1");
    expect(event.stage).toBe("planning");
    expect(event.runtime).toBe("claude-code");
    expect(event.command).toBe("claude plan");
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitProcessOutput emits a process:output event with expected fields", () => {
    emitter.emitProcessOutput("run-5", "proc-2", "some stdout chunk");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("process:output");
    if (event.type !== "process:output") throw new Error("wrong type");
    expect(event.runId).toBe("run-5");
    expect(event.processId).toBe("proc-2");
    expect(event.chunk).toBe("some stdout chunk");
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitProcessCompleted emits a process:completed event with expected fields", () => {
    emitter.emitProcessCompleted("run-6", "proc-3", "execution", "codex", 0, 12345);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("process:completed");
    if (event.type !== "process:completed") throw new Error("wrong type");
    expect(event.runId).toBe("run-6");
    expect(event.processId).toBe("proc-3");
    expect(event.stage).toBe("execution");
    expect(event.runtime).toBe("codex");
    expect(event.exitCode).toBe(0);
    expect(event.durationMs).toBe(12345);
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitProcessCompleted reflects a non-zero exit code", () => {
    emitter.emitProcessCompleted("run-6b", "proc-3b", "execution", "codex", 1, 999);

    const event = listener.mock.calls[0][0] as DashboardEvent;
    if (event.type !== "process:completed") throw new Error("wrong type");
    expect(event.exitCode).toBe(1);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with expected fields", () => {
    emitter.emitQuestionsAnswered("run-7", 4);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:questions-answered");
    if (event.type !== "run:questions-answered") throw new Error("wrong type");
    expect(event.runId).toBe("run-7");
    expect(event.questionCount).toBe(4);
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("emitChatReply emits a run:chat-reply event with expected fields", () => {
    emitter.emitChatReply("run-8", "Here is the answer", 750);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:chat-reply");
    if (event.type !== "run:chat-reply") throw new Error("wrong type");
    expect(event.runId).toBe("run-8");
    expect(event.reply).toBe("Here is the answer");
    expect(event.durationMs).toBe(750);
    expect(isValidIsoTimestamp(event.timestamp)).toBe(true);
  });

  it("supports multiple listeners and off() removing a listener", () => {
    const second = vi.fn();
    emitter.on("dashboard", second);

    emitter.emitRunCreated("run-9", "LIN-9", "org/repo2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", second);
    emitter.emitRunCreated("run-10", "LIN-10", "org/repo3");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is an instance of EventEmitter and emits on the 'dashboard' channel only", () => {
    const otherChannelListener = vi.fn();
    emitter.on("other", otherChannelListener);

    emitter.emitStateChanged("run-11", "Todo", "Planning");

    expect(otherChannelListener).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
