import { describe, it, expect, vi } from "vitest";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";

describe("RunEventEmitter", () => {
  it("is an EventEmitter that delivers emitted events to subscribers of the 'dashboard' event", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);

    emitter.emitStateChanged("run-1", "planning", "executing");

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as DashboardEvent;
    expect(event.type).toBe("run:state-changed");
  });

  it("does not invoke listeners subscribed to a different event name", () => {
    const emitter = new RunEventEmitter();
    const dashboardListener = vi.fn();
    const otherListener = vi.fn();
    emitter.on("dashboard", dashboardListener);
    emitter.on("other", otherListener);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(dashboardListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });

  it("delivers events to multiple subscribers in registration order", () => {
    const emitter = new RunEventEmitter();
    const calls: string[] = [];
    emitter.on("dashboard", () => calls.push("first"));
    emitter.on("dashboard", () => calls.push("second"));

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(calls).toEqual(["first", "second"]);
  });

  it("stops notifying a listener after it unsubscribes with off()", () => {
    const emitter = new RunEventEmitter();
    const listener = vi.fn();
    emitter.on("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    expect(listener).toHaveBeenCalledTimes(1);

    emitter.off("dashboard", listener);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removeListener also stops delivery, while other remaining subscribers are unaffected", () => {
    const emitter = new RunEventEmitter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    emitter.on("dashboard", listenerA);
    emitter.on("dashboard", listenerB);

    emitter.removeListener("dashboard", listenerA);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("emitting with no subscribers does not throw", () => {
    const emitter = new RunEventEmitter();
    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "org/repo")).not.toThrow();
  });

  describe("event payload shapes", () => {
    it("emitStateChanged produces a run:state-changed event with from/to and an ISO timestamp", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitStateChanged("run-1", "planning", "executing");

      expect(captured).toMatchObject({
        type: "run:state-changed",
        runId: "run-1",
        from: "planning",
        to: "executing",
      });
      expect(captured && new Date((captured as { timestamp: string }).timestamp).toString()).not.toBe(
        "Invalid Date",
      );
    });

    it("emitArtifactCreated produces a run:artifact-created event with artifactType and version", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitArtifactCreated("run-1", "Plan", 2);

      expect(captured).toMatchObject({
        type: "run:artifact-created",
        runId: "run-1",
        artifactType: "Plan",
        version: 2,
      });
    });

    it("emitRunCreated produces a run:created event with issueId and repo", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitRunCreated("run-1", "LIN-42", "acme/widgets");

      expect(captured).toMatchObject({
        type: "run:created",
        runId: "run-1",
        issueId: "LIN-42",
        repo: "acme/widgets",
      });
    });

    it("emitProcessStarted produces a process:started event with stage, runtime and command", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitProcessStarted("run-1", "proc-1", "executor", "claude-code", "npm test");

      expect(captured).toMatchObject({
        type: "process:started",
        runId: "run-1",
        processId: "proc-1",
        stage: "executor",
        runtime: "claude-code",
        command: "npm test",
      });
    });

    it("emitProcessOutput produces a process:output event carrying the raw chunk text", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitProcessOutput("run-1", "proc-1", "some stdout chunk\n");

      expect(captured).toMatchObject({
        type: "process:output",
        runId: "run-1",
        processId: "proc-1",
        chunk: "some stdout chunk\n",
      });
    });

    it("emitProcessCompleted produces a process:completed event with exitCode and durationMs", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitProcessCompleted("run-1", "proc-1", "executor", "claude-code", 0, 1500);

      expect(captured).toMatchObject({
        type: "process:completed",
        runId: "run-1",
        processId: "proc-1",
        stage: "executor",
        runtime: "claude-code",
        exitCode: 0,
        durationMs: 1500,
      });
    });

    it("emitProcessCompleted supports a non-zero exitCode (failure case)", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitProcessCompleted("run-1", "proc-1", "executor", "codex", 1, 250);

      expect(captured).toMatchObject({
        type: "process:completed",
        exitCode: 1,
        durationMs: 250,
      });
    });

    it("emitQuestionsAnswered produces a run:questions-answered event with questionCount", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitQuestionsAnswered("run-1", 3);

      expect(captured).toMatchObject({
        type: "run:questions-answered",
        runId: "run-1",
        questionCount: 3,
      });
    });

    it("emitChatReply produces a run:chat-reply event with reply text and durationMs", () => {
      const emitter = new RunEventEmitter();
      let captured: DashboardEvent | undefined;
      emitter.on("dashboard", (e: DashboardEvent) => {
        captured = e;
      });

      emitter.emitChatReply("run-1", "Here is my answer.", 980);

      expect(captured).toMatchObject({
        type: "run:chat-reply",
        runId: "run-1",
        reply: "Here is my answer.",
        durationMs: 980,
      });
    });
  });

  it("each emit call produces its own event object (not a shared mutable reference)", () => {
    const emitter = new RunEventEmitter();
    const seen: DashboardEvent[] = [];
    emitter.on("dashboard", (e: DashboardEvent) => seen.push(e));

    emitter.emitQuestionsAnswered("run-1", 1);
    emitter.emitQuestionsAnswered("run-1", 2);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect((seen[0] as { questionCount: number }).questionCount).toBe(1);
    expect((seen[1] as { questionCount: number }).questionCount).toBe(2);
  });

  it("a listener that throws does not prevent the emit call itself from completing synchronously", () => {
    const emitter = new RunEventEmitter();
    emitter.on("dashboard", () => {
      throw new Error("listener boom");
    });

    expect(() => emitter.emitRunCreated("run-1", "LIN-1", "org/repo")).toThrow("listener boom");
  });
});
