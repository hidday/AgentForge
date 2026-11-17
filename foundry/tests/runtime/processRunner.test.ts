import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTimeoutError } from "../../src/utils/errors.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

function makeFakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.killed = false;
  child.kill = vi.fn((signal: string) => {
    if (signal === "SIGKILL") child.killed = true;
  });
  return child;
}

describe("ProcessRunner", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
    logger = makeLogger();
    spawnMock.mockReset();
  });

  afterEach(async () => {
    // Real WriteStreams opened during a test may still be completing their
    // async fs.open() when the test ends; give them a beat before the
    // directory disappears, to avoid a stray unhandled ENOENT.
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(spoolDir, { recursive: true, force: true });
  });

  describe("mock mode", () => {
    it("throws when no mock handler has been configured", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      await expect(
        runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });

    it("delegates execution to the configured mock handler and logs debug", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const result = await runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ command: "echo", args: ["hi"] }),
      );
      expect(result.stdout).toBe("ok");
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("getActiveProcesses / getProcessOutput", () => {
    it("returns an empty array when nothing is active", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(runner.getActiveProcesses()).toEqual([]);
    });

    it("returns null when no active entry and no log file exists for the id", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
    });

    it("reads tail content from the spool log file when there is no in-memory entry", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const logPath = join(spoolDir, "proc-1.log");
      writeFileSync(logPath, "hello from disk");
      expect(runner.getProcessOutput("proc-1")).toBe("hello from disk");
    });

    it("returns null (not throw) when the log file exists but cannot be read as a file", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const dirPath = join(spoolDir, "proc-dir.log");
      mkdirSync(dirPath);
      expect(runner.getProcessOutput("proc-dir")).toBeNull();
    });
  });

  describe("executeReal", () => {
    it("resolves with stdout/stderr/exitCode on a clean exit, and tracks context-based bookkeeping", async () => {
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      // While running, the process should show up as active.
      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ pid: child.pid, runId: "run-1", stage: "executor" });
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        "echo",
      );

      child.stdout.emit("data", Buffer.from("hello "));
      child.stdout.emit("data", Buffer.from("world"));
      child.emit("close", 0);

      const result = await promise;
      expect(result).toMatchObject({ stdout: "hello world", stderr: "", exitCode: 0, timedOut: false });

      // Process should no longer be active, and its manifest should be marked complete.
      expect(runner.getActiveProcesses()).toHaveLength(0);
      const manifestPath = join(spoolDir, `${active[0].id}.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.exitCode).toBe(0);
      expect(manifest.completedAt).toBeDefined();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );
    });

    it("defaults exitCode to 1 when the child is killed by a signal (close code is null)", async () => {
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
      child.emit("close", null);
      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it("rejects with the underlying error when the child process emits 'error'", async () => {
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "nonexistent-binary", args: [], cwd: "/tmp", timeoutMs: 5000 });
      child.emit("error", new Error("ENOENT: command not found"));
      await expect(promise).rejects.toThrow("ENOENT: command not found");
    });

    it("writes stdin and ends it when stdinData is provided", async () => {
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "x",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        stdinData: "payload",
      });
      expect(child.stdin.write).toHaveBeenCalledWith("payload");
      expect(child.stdin.end).toHaveBeenCalled();
      child.emit("close", 0);
      await promise;
    });

    it("rejects with AgentTimeoutError and escalates to SIGKILL when the child ignores SIGTERM", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 100 });

      await vi.advanceTimersByTimeAsync(100);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.killed).toBe(false);

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      child.emit("close", null);
      await expect(promise).rejects.toThrow(AgentTimeoutError);
    });

    it("does not escalate to SIGKILL if the child already exited after SIGTERM", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.killed = true;
      child.emit("close", null);
      await expect(promise).rejects.toThrow(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
    });

    it("throttles process:output emissions and truncates long chunks to the last 500 characters", async () => {
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "x",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
      });

      const longChunk = "a".repeat(600);
      child.stdout.emit("data", Buffer.from(longChunk));
      // Immediate second chunk should be throttled (within OUTPUT_THROTTLE_MS of the first).
      child.stdout.emit("data", Buffer.from("more-data-that-should-be-throttled"));

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
      expect(emittedChunk).toHaveLength(500);
      expect(emittedChunk).toBe(longChunk.slice(-500));

      child.emit("close", 0);
      await promise;
    });
  });

  describe("rehydrateOrphans", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("does nothing when the spool directory cannot be read", () => {
      rmSync(spoolDir, { recursive: true, force: true });
      const runner = new ProcessRunner("real", logger as never, undefined, join(spoolDir, "gone"));
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that are already marked completed", () => {
      writeFileSync(
        join(spoolDir, "done.json"),
        JSON.stringify({ id: "done", pid: 1, command: "x", args: [], runId: "r", stage: "s", runtime: "claude-code", startedAt: new Date().toISOString(), logFile: "x", completedAt: new Date().toISOString() }),
      );
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("marks a dead orphan as crashed and persists the updated manifest", () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });
      const manifestPath = join(spoolDir, "dead-1.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "dead-1",
          pid: 99999,
          command: "x",
          args: [],
          runId: "run-dead",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "dead-1.log"),
        }),
      );

      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.crashed).toBe(true);
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead-1", pid: 99999 }),
        "Orphaned agent process is dead, marking crashed",
      );
      killSpy.mockRestore();
    });

    it("rehydrates a live orphan into activeProcesses and finalizes it once polling observes it has died", async () => {
      vi.useFakeTimers();
      let killCalls = 0;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        killCalls += 1;
        if (killCalls === 1) return true as never;
        throw new Error("ESRCH");
      });

      const logPath = join(spoolDir, "live-1.log");
      const manifestPath = join(spoolDir, "live-1.json");
      writeFileSync(logPath, "existing output");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "live-1",
          pid: 55555,
          command: "x",
          args: [],
          runId: "run-live",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "live-1", pid: 55555 }),
        "Rehydrating orphaned agent process",
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-live",
        "live-1",
        "executor",
        "claude-code",
        "x",
      );

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toBeDefined();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-live",
        "live-1",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "live-1", pid: 55555 }),
        "Orphaned process has exited",
      );

      killSpy.mockRestore();
    });

    it("logs a warning and continues when a manifest file is malformed JSON", () => {
      writeFileSync(join(spoolDir, "broken.json"), "{not valid json");
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });
  });
});
