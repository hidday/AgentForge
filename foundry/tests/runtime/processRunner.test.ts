import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner, type ActiveProcess } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessContext } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn() };
});

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

/** A minimal fake ChildProcess: an EventEmitter with stdout/stderr streams and a stdin/kill API. */
function makeFakeChild(options: { pid?: number | undefined; unresponsive?: boolean } = {}) {
  const { pid = 4242, unresponsive = false } = options;
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    pid: number | undefined;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn(() => {
    if (!unresponsive) child.killed = true;
    return true;
  });
  return child;
}

describe("ProcessRunner", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.mocked(spawn).mockReset();
    vi.mocked(watch).mockReset();
    rmSync(spoolDir, { recursive: true, force: true });
  });

  describe("mock mode", () => {
    it("throws when no mock handler has been configured", async () => {
      const logger = makeMockLogger();
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

      await expect(
        runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });

    it("delegates to the configured mock handler and logs the invocation", async () => {
      const logger = makeMockLogger();
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const result = {
        stdout: "out",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        timedOut: false,
      };
      const handler = vi.fn().mockResolvedValue(result);
      runner.setMockHandler(handler);

      const options = { command: "claude", args: ["--version"], cwd: "/tmp", timeoutMs: 1000 };
      const out = await runner.execute(options);

      expect(out).toBe(result);
      expect(handler).toHaveBeenCalledWith(options);
      expect(logger.debug).toHaveBeenCalledWith(
        { command: "claude", args: ["--version"], cwd: "/tmp" },
        "Executing mock process",
      );
    });
  });

  describe("real mode — successful and failed runs", () => {
    it("resolves with concatenated stdout/stderr and exit code 0 on success", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "claude",
        args: ["--print"],
        cwd: "/tmp",
        env: { FOO: "bar" },
        timeoutMs: 60_000,
      });

      child.stdout.emit("data", Buffer.from("hello "));
      child.stdout.emit("data", Buffer.from("world"));
      child.stderr.emit("data", Buffer.from("warn"));
      child.emit("close", 0);

      const result = await promise;
      expect(result).toEqual({
        stdout: "hello world",
        stderr: "warn",
        exitCode: 0,
        durationMs: expect.any(Number),
        timedOut: false,
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        ["--print"],
        expect.objectContaining({
          cwd: "/tmp",
          stdio: ["pipe", "pipe", "pipe"],
          env: expect.objectContaining({ FOO: "bar" }),
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ command: "claude", exitCode: 0 }),
        "Process completed",
      );
    });

    it("resolves (does not reject) on a non-zero exit code", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
      });

      child.emit("close", 3);

      const result = await promise;
      expect(result.exitCode).toBe(3);
      expect(result.timedOut).toBe(false);
    });

    it("writes stdinData to the child and ends stdin", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        stdinData: "the prompt",
      });
      child.emit("close", 0);
      await promise;

      expect(child.stdin.write).toHaveBeenCalledWith("the prompt");
      expect(child.stdin.end).toHaveBeenCalledTimes(1);
    });

    it("ends stdin without writing when no stdinData is given", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 60_000 });
      child.emit("close", 0);
      await promise;

      expect(child.stdin.write).not.toHaveBeenCalled();
      expect(child.stdin.end).toHaveBeenCalledTimes(1);
    });

    it("rejects with the underlying error when the child process errors, and cleans up the tracked entry", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const spawnError = new Error("spawn claude ENOENT");
      child.emit("error", spawnError);

      await expect(promise).rejects.toBe(spawnError);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
    });

    it("rejects on spawn error without touching process tracking when no context is given", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

      const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 60_000 });
      const spawnError = new Error("boom");
      child.emit("error", spawnError);

      await expect(promise).rejects.toBe(spawnError);
      expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });
  });

  describe("real mode — concurrent process tracking", () => {
    it("tracks an in-flight process via getActiveProcesses and writes/updates its manifest file", async () => {
      const child = makeFakeChild({ pid: 5150 });
      vi.mocked(spawn).mockReturnValue(child as never);
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      const context: ProcessContext = { runId: "run-42", stage: "planner", runtime: "claude-code" };

      const promise = runner.execute({
        command: "claude",
        args: ["--print"],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      const entry = active[0] as ActiveProcess;
      expect(entry).toMatchObject({
        pid: 5150,
        command: "claude",
        runId: "run-42",
        stage: "planner",
        runtime: "claude-code",
      });
      expect(entry.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(typeof entry.id).toBe("string");

      const manifestPath = join(spoolDir, `${entry.id}.json`);
      const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestBefore).toMatchObject({ id: entry.id, pid: 5150, runId: "run-42" });
      expect(manifestBefore.completedAt).toBeUndefined();

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-42",
        entry.id,
        "planner",
        "claude-code",
        "claude",
      );

      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestAfter.completedAt).toEqual(expect.any(String));
      expect(manifestAfter.exitCode).toBe(0);
      expect(manifestAfter.durationMs).toEqual(expect.any(Number));

      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-42",
        entry.id,
        "planner",
        "claude-code",
        0,
        expect.any(Number),
      );
    });

    it("does not register a tracked entry when the process has no context", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 60_000 });
      expect(runner.getActiveProcesses()).toHaveLength(0);
      child.emit("close", 0);
      await promise;
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });
  });

  describe("real mode — output buffering, throttling, and rolling buffer", () => {
    it("throttles process:output emission to once per 250ms window", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      const context: ProcessContext = { runId: "run-t", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(1_000); // first chunk: 1000 - 0 >= 250 -> emits
      child.stdout.emit("data", Buffer.from("chunk-1"));

      nowSpy.mockReturnValueOnce(1_100); // second chunk: 1100 - 1000 = 100 < 250 -> throttled
      child.stdout.emit("data", Buffer.from("chunk-2"));

      nowSpy.mockReturnValueOnce(1_300); // third chunk: 1300 - 1000 = 300 >= 250 -> emits
      child.stdout.emit("data", Buffer.from("chunk-3"));

      child.emit("close", 0);
      await promise;

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
      expect(emitter.emitProcessOutput).toHaveBeenNthCalledWith(1, "run-t", expect.any(String), "chunk-1");
      expect(emitter.emitProcessOutput).toHaveBeenNthCalledWith(2, "run-t", expect.any(String), "chunk-3");
    });

    it("emits only the trailing 500 characters of an oversized chunk", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      const context: ProcessContext = { runId: "run-big", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const bigChunk = "X".repeat(550) + "[TAIL]";
      child.stdout.emit("data", Buffer.from(bigChunk));
      child.emit("close", 0);
      await promise;

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
      expect(emittedChunk).toBe(bigChunk.slice(-500));
      expect(emittedChunk.length).toBe(500);
    });

    it("truncates the rolling buffer (and getProcessOutput) to the most recent 8KB", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const context: ProcessContext = { runId: "run-roll", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const entry = runner.getActiveProcesses()[0]!;
      const chunkA = "A".repeat(5000);
      const chunkB = "B".repeat(5000) + "[END]";
      child.stdout.emit("data", Buffer.from(chunkA));
      child.stdout.emit("data", Buffer.from(chunkB));

      const buffered = runner.getProcessOutput(entry.id);
      expect(buffered).not.toBeNull();
      expect(buffered!.length).toBe(8 * 1024);
      expect(buffered!.endsWith("[END]")).toBe(true);
      expect(buffered!.includes("A")).toBe(false); // fully rolled off

      child.emit("close", 0);
      await promise;
    });

    it("does not throw and skips emission when no emitter is configured", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const context: ProcessContext = { runId: "run-no-emit", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });

      const entry = runner.getActiveProcesses()[0]!;
      child.stdout.emit("data", Buffer.from("silent-chunk"));
      expect(runner.getProcessOutput(entry.id)).toBe("silent-chunk");

      child.emit("close", 0);
      await expect(promise).resolves.toMatchObject({ exitCode: 0 });
    });
  });

  describe("real mode — timeout and kill handling", () => {
    it("sends SIGTERM at the timeout and rejects with AgentTimeoutError", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const context: ProcessContext = { runId: "run-to", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 1_000,
        context,
      });
      promise.catch(() => {
        // asserted below; avoid an unhandled-rejection warning while we drive the fake clock
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

      child.emit("close", null);

      await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
      await expect(promise).rejects.toThrow('Agent "codex/executor" timed out after 1000ms');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ command: "codex", timeoutMs: 1_000 }),
        "Process timed out",
      );
    });

    it("escalates to SIGKILL if the process is still alive 5s after SIGTERM", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const child = makeFakeChild({ unresponsive: true });
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({ command: "codex", args: [], cwd: "/tmp", timeoutMs: 1_000 });
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
      expect(child.kill).toHaveBeenCalledTimes(2);

      child.emit("close", null);
      await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    });

    it("does not kill the process or time out when it completes before the deadline", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

      const promise = runner.execute({ command: "codex", args: [], cwd: "/tmp", timeoutMs: 5_000 });
      child.emit("close", 0);

      const result = await promise;
      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      expect(child.kill).not.toHaveBeenCalled();
    });
  });

  describe("getProcessOutput", () => {
    it("returns null for an id with no active entry and no log file", () => {
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      expect(runner.getProcessOutput("nonexistent")).toBeNull();
    });

    it("falls back to reading the on-disk log tail once the process entry is cleaned up", async () => {
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const context: ProcessContext = { runId: "run-log", stage: "executor", runtime: "codex" };

      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context,
      });
      const entry = runner.getActiveProcesses()[0]!;
      child.stdout.emit("data", Buffer.from("hello-log-tail"));
      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);

      await vi.waitFor(
        () => {
          const output = runner.getProcessOutput(entry.id);
          expect(output).toContain("hello-log-tail");
        },
        { timeout: 2000, interval: 20 },
      );
    });

    it("returns null when the log file exists but cannot be read as text", () => {
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      // Force existsSync(...) to be true while readFileSync(...) throws (EISDIR).
      mkdirSync(join(spoolDir, "weird-id.log"));
      expect(runner.getProcessOutput("weird-id")).toBeNull();
    });
  });

  describe("rehydrateOrphans", () => {
    it("returns silently when the spool directory cannot be listed", () => {
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      rmSync(spoolDir, { recursive: true, force: true });
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that are already marked completed", () => {
      const killSpy = vi.spyOn(process, "kill");
      writeFileSync(
        join(spoolDir, "done-1.json"),
        JSON.stringify({
          id: "done-1",
          pid: 111,
          command: "claude",
          args: [],
          runId: "run-done",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "done-1.log"),
          completedAt: new Date().toISOString(),
          exitCode: 0,
        }),
      );
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();

      expect(killSpy).not.toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("logs a warning and continues when a manifest file is malformed JSON", () => {
      writeFileSync(join(spoolDir, "broken-1.json"), "{ not valid json");
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken-1.json" }),
        "Failed to process manifest",
      );
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("marks the manifest crashed when the orphan's pid is no longer alive", () => {
      writeFileSync(
        join(spoolDir, "dead-1.json"),
        JSON.stringify({
          id: "dead-1",
          pid: 999_999,
          command: "claude",
          args: [],
          runId: "run-dead",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "dead-1.log"),
        }),
      );
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH: no such process");
      });
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();

      expect(killSpy).toHaveBeenCalledWith(999_999, 0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead-1", pid: 999_999 }),
        "Orphaned agent process is dead, marking crashed",
      );
      expect(runner.getActiveProcesses()).toHaveLength(0);

      const manifest = JSON.parse(readFileSync(join(spoolDir, "dead-1.json"), "utf-8"));
      expect(manifest.crashed).toBe(true);
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toEqual(expect.any(String));
    });

    it("rehydrates a live orphan, tails new log output, and finalizes it once the poll detects it has exited", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

      const logPath = join(spoolDir, "alive-1.log");
      writeFileSync(
        join(spoolDir, "alive-1.json"),
        JSON.stringify({
          id: "alive-1",
          pid: 7777,
          command: "claude",
          args: ["--print"],
          runId: "run-alive",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementationOnce(() => true) // rehydrate: initial aliveness check -> alive
        .mockImplementationOnce(() => true) // first 5s poll tick -> still alive
        .mockImplementationOnce(() => {
          // second 5s poll tick -> process has exited
          throw new Error("ESRCH");
        });

      let capturedWatchCb: (() => void) | undefined;
      const closeMock = vi.fn();
      vi.mocked(watch).mockImplementation((_path, cb) => {
        capturedWatchCb = cb as () => void;
        return { close: closeMock } as never;
      });

      const emitter = makeMockEmitter();
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();

      // No log file existed yet at rehydrate time -> buffer starts empty.
      expect(runner.getProcessOutput("alive-1")).toBe("");
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "claude-code",
        "claude",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-1", pid: 7777, stage: "executor" }),
        "Rehydrating orphaned agent process",
      );

      // Simulate the orphaned process writing new output to its log file.
      writeFileSync(logPath, "chunk1");
      expect(capturedWatchCb).toBeTypeOf("function");
      capturedWatchCb!();
      expect(runner.getProcessOutput("alive-1")).toBe("chunk1");
      expect(emitter.emitProcessOutput).toHaveBeenCalledWith("run-alive", "alive-1", "chunk1");

      // First poll tick: process still alive -> stays tracked.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Second poll tick: process has exited -> finalize.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(killSpy).toHaveBeenCalledTimes(3);
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        { processId: "alive-1", pid: 7777 },
        "Orphaned process has exited",
      );

      const manifest = JSON.parse(readFileSync(join(spoolDir, "alive-1.json"), "utf-8"));
      expect(manifest.completedAt).toEqual(expect.any(String));
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.crashed).toBeUndefined();
    });

    it("ignores unreadable log files and closes the watcher once the tracked entry is gone", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

      const logPath = join(spoolDir, "alive-2.log");
      writeFileSync(logPath, "seed");
      writeFileSync(
        join(spoolDir, "alive-2.json"),
        JSON.stringify({
          id: "alive-2",
          pid: 8888,
          command: "claude",
          args: [],
          runId: "run-alive-2",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      vi.spyOn(process, "kill").mockImplementation(() => true);

      let capturedWatchCb: (() => void) | undefined;
      const closeMock = vi.fn();
      vi.mocked(watch).mockImplementation((_path, cb) => {
        capturedWatchCb = cb as () => void;
        return { close: closeMock } as never;
      });

      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getProcessOutput("alive-2")).toBe("seed");

      // Delete the log file so the watch callback's readFileSync throws; it must be swallowed.
      rmSync(logPath);
      capturedWatchCb!();
      expect(runner.getProcessOutput("alive-2")).toBe("seed");
      expect(emitter.emitProcessOutput).not.toHaveBeenCalled();

      // Now simulate the entry having already been cleaned up elsewhere.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "alive-2",
      );
      capturedWatchCb!();
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
  });
});

// Sanity check that the mocked fs.watch never touches the real filesystem watcher API
// when a test forgets to configure an implementation (defensive; documents intent).
describe("fs.watch mock isolation", () => {
  it("is a vi.fn() with no default passthrough", () => {
    expect(vi.isMockFunction(watch)).toBe(true);
  });
  it("does not spawn real child processes via the mocked spawn", () => {
    expect(vi.isMockFunction(spawn)).toBe(true);
  });
  it("confirms existsSync remains the real implementation for unrelated paths", () => {
    expect(existsSync("/definitely/does/not/exist/xyz")).toBe(false);
  });
});
