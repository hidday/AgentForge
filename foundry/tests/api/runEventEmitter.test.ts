import { describe, it, expect } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function listenOnce(emitter: RunEventEmitter): Promise<DashboardEvent> {
  return new Promise((resolve) => {
    emitter.once("dashboard", (event: DashboardEvent) => resolve(event));
  });
}

describe("RunEventEmitter", () => {
  it("emitStateChanged emits a run:state-changed event with all fields and a valid timestamp", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitStateChanged("run-1", "PLANNING", "EXECUTING");
    const event = await pending;

    expect(event.type).toBe("run:state-changed");
    if (event.type !== "run:state-changed") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.from).toBe("PLANNING");
    expect(event.to).toBe("EXECUTING");
    expect(event.timestamp).toMatch(ISO_REGEX);
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
  });

  it("emitArtifactCreated emits a run:artifact-created event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitArtifactCreated("run-1", "Plan", 2);
    const event = await pending;

    expect(event.type).toBe("run:artifact-created");
    if (event.type !== "run:artifact-created") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.artifactType).toBe("Plan");
    expect(event.version).toBe(2);
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitRunCreated emits a run:created event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitRunCreated("run-1", "LIN-99", "repo-a");
    const event = await pending;

    expect(event.type).toBe("run:created");
    if (event.type !== "run:created") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.issueId).toBe("LIN-99");
    expect(event.repo).toBe("repo-a");
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitProcessStarted emits a process:started event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "claude --print");
    const event = await pending;

    expect(event.type).toBe("process:started");
    if (event.type !== "process:started") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.processId).toBe("proc-1");
    expect(event.stage).toBe("executor");
    expect(event.runtime).toBe("claude-code");
    expect(event.command).toBe("claude --print");
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitProcessOutput emits a process:output event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitProcessOutput("run-1", "proc-1", "some output chunk");
    const event = await pending;

    expect(event.type).toBe("process:output");
    if (event.type !== "process:output") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.processId).toBe("proc-1");
    expect(event.chunk).toBe("some output chunk");
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitProcessCompleted emits a process:completed event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1234);
    const event = await pending;

    expect(event.type).toBe("process:completed");
    if (event.type !== "process:completed") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.processId).toBe("proc-1");
    expect(event.stage).toBe("executor");
    expect(event.runtime).toBe("claude-code");
    expect(event.exitCode).toBe(0);
    expect(event.durationMs).toBe(1234);
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitQuestionsAnswered emits a run:questions-answered event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitQuestionsAnswered("run-1", 3);
    const event = await pending;

    expect(event.type).toBe("run:questions-answered");
    if (event.type !== "run:questions-answered") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.questionCount).toBe(3);
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("emitChatReply emits a run:chat-reply event with all fields", async () => {
    const emitter = new RunEventEmitter();
    const pending = listenOnce(emitter);

    emitter.emitChatReply("run-1", "Here is my reply", 555);
    const event = await pending;

    expect(event.type).toBe("run:chat-reply");
    if (event.type !== "run:chat-reply") throw new Error("wrong type");
    expect(event.runId).toBe("run-1");
    expect(event.reply).toBe("Here is my reply");
    expect(event.durationMs).toBe(555);
    expect(event.timestamp).toMatch(ISO_REGEX);
  });

  it("extends EventEmitter and supports multiple listeners on the same 'dashboard' channel", () => {
    const emitter = new RunEventEmitter();
    const received: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => received.push(e));
    emitter.on("dashboard", (e: DashboardEvent) => received.push(e));

    emitter.emitRunCreated("run-x", "LIN-1", "repo-a");

    expect(received.length).toBe(2);
  });
});
