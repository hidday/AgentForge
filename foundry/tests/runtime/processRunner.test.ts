import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Fake ChildProcess -------------------------------------------------

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killCalls: string[] = [];

  kill(signal?: string): boolean {
    this.killCalls.push(signal ?? "SIGTERM");
    // Simulate a well-behaved process: SIGTERM actually kills it (sets killed),
    // but individual tests can override this by not emitting close.
    this.killed = true;
    return true;
  }
}

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// fs.watch creates a real, persistent FSWatcher handle that would keep the
// process alive across tests (rehydrateOrphans' orphan-tailing path uses it).
// We stub it out so orphan-rehydration tests don't leak OS watch handles,
// while still capturing the registered callback so tests can drive it.
const fakeWatcherClose = vi.fn();
const fsWatchMock = vi.fn((_path: string, cb: () => void) => {
  void cb;
  return { close: fakeWatcherClose };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: (...args: Parameters<typeof fsWatchMock>) => fsWatchMock(...args),
  };
});

// Imported after the mock is registered so the module under test picks it up.
const { ProcessRunner } = await import("../../src/runtime/processRunner.js");
const { AgentTimeoutError } = await import("../../src/utils/errors.js");

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

describe("ProcessRunner", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
    spawnMock.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Log writes go through an async fs.WriteStream (open/write/end all
    // queue on the libuv threadpool); give any in-flight I/O from the test
    // a chance to settle before we remove the spool directory, so it
    // doesn't throw a stray ENOENT after the test has already finished.
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(spoolDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates the spool directory recursively", () => {
      const nested = join(spoolDir, "a", "b", "c");
      const logger = makeLogger();
      new ProcessRunner("real", logger as never, undefined, nested);
      expect(existsSync(nested)).toBe(true);
    });
  });

  describe("mock mode", () => {
    it("delegates to the configured mock handler", async () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "hi",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const result = await runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(result.stdout).toBe("hi");
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("throws when mock mode is used without a configured handler", async () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

      await expect(
        runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });
  });

  describe("real mode: successful execution", () => {
    it("captures stdout/stderr and resolves with exit code 0", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: ["-e", "..."],
        cwd: "/tmp",
        timeoutMs: 5000,
      });

      child.stdout.emit("data", Buffer.from("hello "));
      child.stdout.emit("data", Buffer.from("world"));
      child.stderr.emit("data", Buffer.from("warn!"));
      child.emit("close", 0);

      const result = await promise;
      expect(result).toEqual({
        stdout: "hello world",
        stderr: "warn!",
        exitCode: 0,
        durationMs: expect.any(Number),
        timedOut: false,
      });
    });

    it("writes stdinData to the child and closes stdin", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "cat",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        stdinData: "input data",
      });
      child.emit("close", 0);
      await promise;

      expect(child.stdin.write).toHaveBeenCalledWith("input data");
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it("closes stdin without writing when no stdinData is provided", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "cat", args: [], cwd: "/tmp", timeoutMs: 5000 });
      child.emit("close", 0);
      await promise;

      expect(child.stdin.write).not.toHaveBeenCalled();
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it("resolves (does not reject) on non-zero exit codes, passing the code through", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
      child.stderr.emit("data", Buffer.from("boom"));
      child.emit("close", 3);

      const result = await promise;
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toBe("boom");
      expect(result.timedOut).toBe(false);
    });

    it("defaults exitCode to 1 when close is emitted with a null code (signal kill)", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
      child.emit("close", null);

      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it("merges extra env vars with process.env when spawning", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/work",
        timeoutMs: 5000,
        env: { FOO: "bar" },
      });
      child.emit("close", 0);
      await promise;

      const [command, args, spawnOpts] = spawnMock.mock.calls[0]!;
      expect(command).toBe("node");
      expect(args).toEqual([]);
      expect((spawnOpts as { cwd: string }).cwd).toBe("/work");
      expect((spawnOpts as { env: Record<string, string> }).env.FOO).toBe("bar");
      // process.env values should still be present alongside the override.
      expect((spawnOpts as { env: Record<string, string> }).env.PATH).toBe(process.env.PATH);
    });
  });

  describe("real mode: spawn errors", () => {
    it("rejects with the underlying error when the child process errors (e.g. ENOENT)", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "does-not-exist",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
      });

      const spawnErr = Object.assign(new Error("spawn does-not-exist ENOENT"), {
        code: "ENOENT",
      });
      child.emit("error", spawnErr);

      await expect(promise).rejects.toThrow("spawn does-not-exist ENOENT");
    });

    it("cleans up the tracked process entry and emits process:completed(-1) on spawn error", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner(
        "real",
        logger as never,
        emitter as never,
        spoolDir,
      );

      const promise = runner.execute({
        command: "bad",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
      });

      // Process was registered as active before the error fired.
      expect(runner.getActiveProcesses()).toHaveLength(1);

      child.emit("error", new Error("boom"));
      await expect(promise).rejects.toThrow("boom");

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "planner",
        "claude-code",
        -1,
        expect.any(Number),
      );
    });
  });

  describe("real mode: timeouts", () => {
    it("sends SIGTERM after the timeout elapses and rejects with AgentTimeoutError", async () => {
      vi.useFakeTimers();
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "sleep",
        args: ["100"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });
      // Swallow the rejection until we're ready to assert, so it doesn't
      // surface as an unhandled rejection while we advance fake timers.
      const settled = promise.catch((e) => e);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.killCalls).toContain("SIGTERM");

      // The process "dies" from SIGTERM, emitting close.
      child.emit("close", null);

      const err = await settled;
      expect(err).toBeInstanceOf(AgentTimeoutError);
      expect((err as InstanceType<typeof AgentTimeoutError>).timeoutMs).toBe(1000);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ command: "sleep", timeoutMs: 1000 }),
        "Process timed out",
      );
    });

    it("escalates to SIGKILL if the process has not died 5s after SIGTERM", async () => {
      vi.useFakeTimers();
      const child = new FakeChildProcess();
      // Simulate a stuck process: kill() sends the signal but doesn't actually
      // terminate it (killed stays false) until we choose to emit close.
      child.kill = vi.fn((signal?: string) => {
        child.killCalls.push(signal ?? "SIGTERM");
        return true;
      }) as never;
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "sleep",
        args: ["100"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });
      const settled = promise.catch((e) => e);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.killCalls).toEqual(["SIGTERM"]);

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.killCalls).toEqual(["SIGTERM", "SIGKILL"]);

      child.emit("close", null);
      await settled;
    });

    it("does not send SIGKILL if the process already exited after SIGTERM", async () => {
      vi.useFakeTimers();
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "sleep",
        args: ["100"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });
      const settled = promise.catch((e) => e);

      await vi.advanceTimersByTimeAsync(1000);
      // Default FakeChildProcess.kill() sets killed=true immediately.
      child.emit("close", null);
      await settled;

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.killCalls).toEqual(["SIGTERM"]);
    });

    it("clears the timeout on normal completion so it never fires", async () => {
      vi.useFakeTimers();
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });
      child.emit("close", 0);
      const result = await promise;
      expect(result.exitCode).toBe(0);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(child.killCalls).toEqual([]);
    });
  });

  describe("real mode: active process tracking, manifests and logs", () => {
    it("registers an active process, writes a manifest, and emits process:started when context is set", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: ["run.js"],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-42", stage: "executor", runtime: "codex" },
      });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        pid: 4242,
        command: "node",
        runId: "run-42",
        stage: "executor",
        runtime: "codex",
      });

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-42",
        active[0]!.id,
        "executor",
        "codex",
        "node",
      );

      const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest).toMatchObject({
        pid: 4242,
        runId: "run-42",
        stage: "executor",
        runtime: "codex",
        command: "node",
      });

      child.emit("close", 0);
      await promise;

      // Manifest updated with completion info; active process removed.
      expect(runner.getActiveProcesses()).toHaveLength(0);
      const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(finalManifest.exitCode).toBe(0);
      expect(finalManifest.completedAt).toBeTruthy();

      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-42",
        active[0]!.id,
        "executor",
        "codex",
        0,
        expect.any(Number),
      );
    });

    it("does not track an active process when no context is provided", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({ command: "node", args: [], cwd: "/tmp", timeoutMs: 5000 });
      expect(runner.getActiveProcesses()).toHaveLength(0);
      child.emit("close", 0);
      await promise;

      expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });

    it("writes stdout/stderr chunks to the log file for a tracked process", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-log", stage: "planner", runtime: "claude-code" },
      });
      const [{ id }] = runner.getActiveProcesses();

      child.stdout.emit("data", Buffer.from("out-chunk"));
      child.stderr.emit("data", Buffer.from("err-chunk"));
      child.emit("close", 0);
      await promise;

      const logPath = join(spoolDir, `${id}.log`);
      // The WriteStream flushes asynchronously; poll until it lands on disk.
      await vi.waitFor(() => {
        const contents = readFileSync(logPath, "utf-8");
        expect(contents).toContain("out-chunk");
        expect(contents).toContain("err-chunk");
      });
    });
  });

  describe("getProcessOutput", () => {
    it("returns the rolling buffer for an active process", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "r", stage: "planner", runtime: "claude-code" },
      });
      const [{ id }] = runner.getActiveProcesses();
      child.stdout.emit("data", Buffer.from("live output"));

      expect(runner.getProcessOutput(id)).toBe("live output");
      child.emit("close", 0);
    });

    it("falls back to the log file on disk once the process is no longer active", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "r", stage: "planner", runtime: "claude-code" },
      });
      const [{ id }] = runner.getActiveProcesses();
      child.stdout.emit("data", Buffer.from("finished output"));
      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      // The WriteStream flushes asynchronously; poll until it lands on disk.
      await vi.waitFor(() => {
        expect(runner.getProcessOutput(id)).toBe("finished output");
      });
    });

    it("returns null when there is no active entry and no log file", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
    });

    it("truncates the returned buffer to the rolling max size", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "r", stage: "planner", runtime: "claude-code" },
      });
      const [{ id }] = runner.getActiveProcesses();
      const big = "x".repeat(9000);
      child.stdout.emit("data", Buffer.from(big));

      const buffered = runner.getProcessOutput(id)!;
      expect(buffered.length).toBeLessThanOrEqual(8 * 1024);
      expect(buffered.endsWith("x")).toBe(true);

      child.emit("close", 0);
      await promise;
    });
  });

  describe("output throttling", () => {
    it("throttles process:output emissions to at most one per 250ms window", async () => {
      vi.useFakeTimers();
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context: { runId: "r", stage: "planner", runtime: "claude-code" },
      });

      child.stdout.emit("data", Buffer.from("chunk1"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      // Second chunk within the throttle window is suppressed.
      child.stdout.emit("data", Buffer.from("chunk2"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(300);
      child.stdout.emit("data", Buffer.from("chunk3"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
      expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith("r", expect.any(String), "chunk3");

      child.emit("close", 0);
      await promise;
    });

    it("only sends the last 500 characters of a chunk when it exceeds that size", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "r", stage: "planner", runtime: "claude-code" },
      });

      const long = "y".repeat(600) + "TAIL";
      child.stdout.emit("data", Buffer.from(long));

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      const [, , chunk] = emitter.emitProcessOutput.mock.calls[0]!;
      expect(chunk.length).toBe(500);
      expect(chunk.endsWith("TAIL")).toBe(true);

      child.emit("close", 0);
      await promise;
    });
  });

  describe("rehydrateOrphans", () => {
    it("returns silently when the spool directory cannot be read", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner(
        "real",
        logger as never,
        undefined,
        join(spoolDir, "does-not-exist-subdir"),
      );
      rmSync(join(spoolDir, "does-not-exist-subdir"), { recursive: true, force: true });
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that already have completedAt set", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      writeFileSync(
        join(spoolDir, "done.json"),
        JSON.stringify({
          id: "done",
          pid: 999999,
          command: "x",
          args: [],
          runId: "r",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "done.log"),
          completedAt: new Date().toISOString(),
        }),
      );

      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        "Rehydrating orphaned agent process",
      );
    });

    it("marks a manifest crashed when its pid is no longer alive", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const manifestPath = join(spoolDir, "dead.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "dead",
          // PID unlikely to be alive / this process cannot signal it.
          pid: 999999999,
          command: "x",
          args: [],
          runId: "r",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "dead.log"),
        }),
      );

      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead", pid: 999999999 }),
        "Orphaned agent process is dead, marking crashed",
      );
      const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(updated.crashed).toBe(true);
      expect(updated.exitCode).toBe(-1);
      expect(updated.completedAt).toBeTruthy();
    });

    it("logs a warning and continues when a manifest file is malformed JSON", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });

    it("ignores non-.json files in the spool directory", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "notes.txt"), "hello");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("rehydrates a manifest whose pid is alive: tracks it and emits process:started", () => {
      // fs.watch is stubbed above; fake timers keep the orphan-tailing
      // setInterval poll from actually scheduling and holding the process open.
      vi.useFakeTimers();
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logPath = join(spoolDir, "alive.log");
      writeFileSync(logPath, "previous output");
      writeFileSync(
        join(spoolDir, "alive.json"),
        JSON.stringify({
          id: "alive",
          // Our own pid is always alive during the test.
          pid: process.pid,
          command: "node",
          args: [],
          runId: "run-alive",
          stage: "executor",
          runtime: "codex",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      runner.rehydrateOrphans();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive", runId: "run-alive", pid: process.pid });
      expect(runner.getProcessOutput("alive")).toBe("previous output");

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive",
        "executor",
        "codex",
        "node",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive", pid: process.pid }),
        "Rehydrating orphaned agent process",
      );
    });

    it("tails growth on an orphan's log file and finalizes it once its pid stops responding", () => {
      vi.useFakeTimers();
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logPath = join(spoolDir, "orphan.log");
      const manifestPath = join(spoolDir, "orphan.json");
      writeFileSync(logPath, "start");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "orphan",
          pid: process.pid,
          command: "node",
          args: [],
          runId: "run-o",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      fsWatchMock.mockClear();
      runner.rehydrateOrphans();
      expect(fsWatchMock).toHaveBeenCalledOnce();
      const watchCallback = fsWatchMock.mock.calls[0]![1] as () => void;

      // Simulate the log file growing on disk; the watcher should pick up the delta.
      writeFileSync(logPath, "start+more");
      watchCallback();
      expect(runner.getProcessOutput("orphan")).toBe("start+more");

      // Remove the manifest so finalizeOrphan's own read fails (best-effort branch).
      rmSync(manifestPath);

      // Simulate the underlying process dying: process.kill throws => finalize.
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH: no such process");
      });
      vi.advanceTimersByTime(5_000);
      killSpy.mockRestore();

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(fakeWatcherClose).toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-o",
        "orphan",
        "planner",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan", pid: process.pid }),
        "Orphaned process has exited",
      );

      // The entry is now gone; a further watch callback should just close the watcher.
      fakeWatcherClose.mockClear();
      watchCallback();
      expect(fakeWatcherClose).toHaveBeenCalled();
    });

    it("tolerates a missing log file when rehydrating an alive orphan and when first tailing it", () => {
      vi.useFakeTimers();
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logPath = join(spoolDir, "nolog.log");
      // Intentionally do not create the log file: manifest references a log
      // that hasn't been written yet.
      writeFileSync(
        join(spoolDir, "nolog.json"),
        JSON.stringify({
          id: "nolog",
          pid: process.pid,
          command: "node",
          args: [],
          runId: "run-nolog",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getProcessOutput("nolog")).toBe("");
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-nolog",
        "nolog",
        "planner",
        "claude-code",
        "node",
      );
    });

    it("swallows a read error inside the orphan watch callback and leaves the buffer unchanged", () => {
      vi.useFakeTimers();
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logPath = join(spoolDir, "flaky.log");
      writeFileSync(logPath, "seed");
      writeFileSync(
        join(spoolDir, "flaky.json"),
        JSON.stringify({
          id: "flaky",
          pid: process.pid,
          command: "node",
          args: [],
          runId: "run-flaky",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      fsWatchMock.mockClear();
      runner.rehydrateOrphans();
      const watchCallback = fsWatchMock.mock.calls[0]![1] as () => void;

      // The log file disappears before the watcher fires — readFileSync throws.
      rmSync(logPath);
      expect(() => watchCallback()).not.toThrow();
      expect(runner.getProcessOutput("flaky")).toBe("seed");
    });
  });

  describe("edge cases in file handling", () => {
    it("getProcessOutput returns null when the log path exists but cannot be read as a file", () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      // Directory sharing the expected log filename: existsSync is true,
      // but readFileSync on a directory throws EISDIR.
      const dirAsLog = join(spoolDir, "weird-id.log");
      mkdirSync(dirAsLog);

      expect(runner.getProcessOutput("weird-id")).toBeNull();
    });

    it("cleanupProcess still emits process:completed and logs even if the manifest file is missing", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
        context: { runId: "run-nomanifest", stage: "planner", runtime: "claude-code" },
      });
      const [{ id }] = runner.getActiveProcesses();
      rmSync(join(spoolDir, `${id}.json`));

      child.emit("close", 0);
      await promise;

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: id, exitCode: 0, runId: "run-nomanifest" }),
        "Agent process completed",
      );
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-nomanifest",
        id,
        "planner",
        "claude-code",
        0,
        expect.any(Number),
      );
    });
  });
});
