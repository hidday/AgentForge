import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// --- fs mock -----------------------------------------------------------
const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: fsMocks.mkdirSync,
  createWriteStream: fsMocks.createWriteStream,
  readFileSync: fsMocks.readFileSync,
  readdirSync: fsMocks.readdirSync,
  writeFileSync: fsMocks.writeFileSync,
  existsSync: fsMocks.existsSync,
  watch: fsMocks.watch,
}));

// --- child_process mock --------------------------------------------------
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

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
  } as unknown as RunEventEmitter;
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

function makeFakeWriteStream() {
  return { write: vi.fn(), end: vi.fn() };
}

const baseOptions: ProcessSpawnOptions = {
  command: "echo",
  args: ["hi"],
  cwd: "/work",
  timeoutMs: 5_000,
};

describe("ProcessRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readdirSync.mockReturnValue([]);
    fsMocks.createWriteStream.mockImplementation(() => makeFakeWriteStream());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("ensures the spool directory exists", () => {
      new ProcessRunner("mock", makeLogger() as never, makeEmitter(), "/tmp/spool");
      expect(fsMocks.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("spool"), {
        recursive: true,
      });
    });
  });

  describe("mock mode", () => {
    it("throws if no mock handler is configured", async () => {
      const runner = new ProcessRunner("mock", makeLogger() as never);
      await expect(runner.execute(baseOptions)).rejects.toThrow(
        "Mock mode enabled but no mock handler configured",
      );
    });

    it("delegates to the configured mock handler", async () => {
      const runner = new ProcessRunner("mock", makeLogger() as never);
      const result: ProcessResult = {
        stdout: "mocked",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
      };
      const handler = vi.fn().mockResolvedValue(result);
      runner.setMockHandler(handler);

      await expect(runner.execute(baseOptions)).resolves.toBe(result);
      expect(handler).toHaveBeenCalledWith(baseOptions);
    });
  });

  describe("real mode: executeReal", () => {
    it("resolves with captured stdout/stderr and exit code 0 on success", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never);

      const promise = runner.execute({ ...baseOptions, stdinData: "input data" });

      expect(child.stdin.write).toHaveBeenCalledWith("input data");
      expect(child.stdin.end).toHaveBeenCalled();

      child.stdout.emit("data", Buffer.from("hello "));
      child.stdout.emit("data", Buffer.from("world"));
      child.stderr.emit("data", Buffer.from("warn: ok"));
      child.emit("close", 0);

      const result = await promise;
      expect(result).toEqual({
        stdout: "hello world",
        stderr: "warn: ok",
        exitCode: 0,
        durationMs: expect.any(Number) as unknown as number,
        timedOut: false,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 0 }),
        "Process completed",
      );
    });

    it("ends stdin without writing when no stdinData is provided", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute(baseOptions);
      expect(child.stdin.write).not.toHaveBeenCalled();
      expect(child.stdin.end).toHaveBeenCalled();

      child.emit("close", 0);
      await promise;
    });

    it("resolves (does not reject) with a non-zero exit code", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute(baseOptions);
      child.stderr.emit("data", Buffer.from("boom"));
      child.emit("close", 17);

      const result = await promise;
      expect(result.exitCode).toBe(17);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toBe("boom");
    });

    it("defaults exitCode to 1 when close is emitted with a null code", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute(baseOptions);
      child.emit("close", null);

      const result = await promise;
      expect(result.exitCode).toBe(1);
    });

    it("rejects when the child process itself errors (e.g. ENOENT)", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute(baseOptions);
      const err = new Error("spawn echo ENOENT");
      child.emit("error", err);

      await expect(promise).rejects.toBe(err);
    });

    it("merges extra env vars with process.env when spawning", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute({ ...baseOptions, env: { FOO: "bar" } });
      child.emit("close", 0);
      await promise;

      expect(spawnMock).toHaveBeenCalledWith(
        "echo",
        ["hi"],
        expect.objectContaining({
          cwd: "/work",
          env: expect.objectContaining({ FOO: "bar" }) as unknown as Record<string, string>,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    });

    describe("timeout handling", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const logger = makeLogger();
        const runner = new ProcessRunner("real", logger as never);

        const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });
        // Prevent an unhandled-rejection warning before we've attached below.
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(child.kill).toHaveBeenCalledWith("SIGTERM");

        // Simulate the (killed) process actually exiting.
        child.emit("close", null);

        await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
        await expect(promise).rejects.toThrow(/timed out after 1000ms/);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ command: "echo", timeoutMs: 1_000 }),
          "Process timed out",
        );
      });

      it("escalates to SIGKILL 5s later if the process has not exited/killed flag not set", async () => {
        const child = new FakeChildProcess();
        // Override kill so `killed` never flips true, forcing the escalation branch.
        child.kill = vi.fn().mockReturnValue(true);
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never);

        const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

        await vi.advanceTimersByTimeAsync(5_000);
        expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

        child.emit("close", null);
        await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
      });

      it("does not escalate to SIGKILL when the process was already killed", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never);

        const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(child.killed).toBe(true); // default fake kill() sets this
        await vi.advanceTimersByTimeAsync(5_000);
        expect(child.kill).toHaveBeenCalledTimes(1);

        child.emit("close", null);
        await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
      });

      it("uses '<runtime>/<stage>' as the timeout label when a context is provided", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());

        const promise = runner.execute({
          ...baseOptions,
          timeoutMs: 1_000,
          context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        });
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(1_000);
        child.emit("close", null);

        await expect(promise).rejects.toThrow(/claude-code\/executor/);
      });

      it("clears the timeout and does not reject when the process completes before the deadline", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never);

        const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
        child.emit("close", 0);
        const result = await promise;

        expect(result.timedOut).toBe(false);
        // Advancing well past the timeout afterward must not kill anything.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(child.kill).not.toHaveBeenCalled();
      });
    });

    describe("active process tracking (context provided)", () => {
      const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

      it("registers the process, writes a manifest, and emits process:started", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });

        expect(fsMocks.createWriteStream).toHaveBeenCalledWith(
          expect.stringContaining(".log"),
          { flags: "a" },
        );
        expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining(".json"),
          expect.stringContaining('"runId": "run-1"') as unknown as string,
        );
        expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
          "run-1",
          expect.any(String),
          "planner",
          "claude-code",
          "echo",
        );

        const active = runner.getActiveProcesses();
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({
          pid: 4242,
          command: "echo",
          runId: "run-1",
          stage: "planner",
          runtime: "claude-code",
        });
        expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

        child.emit("close", 0);
        await promise;

        // Once completed, the process is no longer "active".
        expect(runner.getActiveProcesses()).toHaveLength(0);
      });

      it("writes an updated manifest and emits process:completed on close", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        fsMocks.readFileSync.mockReturnValue(
          JSON.stringify({ id: "x", pid: 4242, command: "echo", args: [], runId: "run-1" }),
        );
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        child.emit("close", 0);
        await promise;

        expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
          "run-1",
          expect.any(String),
          "planner",
          "claude-code",
          0,
          expect.any(Number) as unknown as number,
        );
      });

      it("best-effort no-ops the manifest rewrite when the manifest file cannot be read back", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        fsMocks.readFileSync.mockImplementation(() => {
          throw new Error("ENOENT");
        });
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        child.emit("close", 0);

        await expect(promise).resolves.toMatchObject({ exitCode: 0 });
        // Still emits completion even though the manifest rewrite failed.
        expect(emitter.emitProcessCompleted).toHaveBeenCalled();
      });

      it("cleans up and emits process:completed with exitCode -1 when the child errors", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        const err = new Error("spawn failed");
        child.emit("error", err);

        await expect(promise).rejects.toBe(err);
        expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
          "run-1",
          expect.any(String),
          "planner",
          "claude-code",
          -1,
          expect.any(Number) as unknown as number,
        );
        expect(runner.getActiveProcesses()).toHaveLength(0);
      });

      it("appends stdout/stderr chunks to the rolling buffer and the per-process log stream", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const logStream = makeFakeWriteStream();
        fsMocks.createWriteStream.mockReturnValue(logStream);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter(), "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        child.stdout.emit("data", Buffer.from("chunk-1"));

        const processId = runner.getActiveProcesses()[0]!.id;
        expect(runner.getProcessOutput(processId)).toBe("chunk-1");
        expect(logStream.write).toHaveBeenCalledWith(Buffer.from("chunk-1"));

        child.emit("close", 0);
        await promise;
      });

      it("trims the rolling buffer to the last 8KB once it grows past the cap", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter(), "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        const processId = runner.getActiveProcesses()[0]!.id;

        const big = "A".repeat(5_000);
        child.stdout.emit("data", Buffer.from(big));
        child.stdout.emit("data", Buffer.from(big));
        child.stdout.emit("data", Buffer.from("TAIL"));

        const buffered = runner.getProcessOutput(processId)!;
        expect(buffered.length).toBeLessThanOrEqual(8 * 1024);
        expect(buffered.endsWith("TAIL")).toBe(true);

        child.emit("close", 0);
        await promise;
      });

      it("throttles process:output emissions to once per 250ms, keeping only the recent tail", async () => {
        vi.useFakeTimers();
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        child.stdout.emit("data", Buffer.from("first"));
        expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

        // Within the throttle window: suppressed.
        child.stdout.emit("data", Buffer.from("second"));
        expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

        // After the window: emits again.
        await vi.advanceTimersByTimeAsync(300);
        child.stdout.emit("data", Buffer.from("third"));
        expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

        child.emit("close", 0);
        await promise;
      });

      it("does not attempt to emit process:output when no emitter is configured", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        expect(() => child.stdout.emit("data", Buffer.from("x"))).not.toThrow();

        child.emit("close", 0);
        await expect(promise).resolves.toMatchObject({ exitCode: 0 });
      });

      it("truncates an oversized single output chunk to the last 500 chars before emitting", async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const emitter = makeEmitter();
        const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

        const promise = runner.execute({ ...baseOptions, context });
        const huge = "B".repeat(1000) + "END";
        child.stdout.emit("data", Buffer.from(huge));

        const [, , chunk] = emitter.emitProcessOutput.mock.calls[0] as [string, string, string];
        expect(chunk.length).toBe(500);
        expect(chunk.endsWith("END")).toBe(true);

        child.emit("close", 0);
        await promise;
      });
    });

    describe("getActiveProcesses / getProcessOutput (idle, no in-flight process)", () => {
      it("returns an empty list when nothing is running", () => {
        const runner = new ProcessRunner("real", makeLogger() as never);
        expect(runner.getActiveProcesses()).toEqual([]);
      });

      it("returns null when the process is unknown and no log file exists", () => {
        fsMocks.existsSync.mockReturnValue(false);
        const runner = new ProcessRunner("real", makeLogger() as never);
        expect(runner.getProcessOutput("nope")).toBeNull();
      });

      it("reads the tail of the on-disk log for a completed process", () => {
        fsMocks.existsSync.mockReturnValue(true);
        fsMocks.readFileSync.mockReturnValue("logged output");
        const runner = new ProcessRunner("real", makeLogger() as never);
        expect(runner.getProcessOutput("done-id")).toBe("logged output");
      });

      it("returns null when existsSync throws", () => {
        fsMocks.existsSync.mockImplementation(() => {
          throw new Error("fs error");
        });
        const runner = new ProcessRunner("real", makeLogger() as never);
        expect(runner.getProcessOutput("x")).toBeNull();
      });

      it("returns null when readFileSync throws even though the file exists", () => {
        fsMocks.existsSync.mockReturnValue(true);
        fsMocks.readFileSync.mockImplementation(() => {
          throw new Error("unreadable");
        });
        const runner = new ProcessRunner("real", makeLogger() as never);
        expect(runner.getProcessOutput("x")).toBeNull();
      });
    });
  });

  describe("rehydrateOrphans", () => {
    it("returns silently when the spool directory cannot be listed", () => {
      fsMocks.readdirSync.mockImplementation(() => {
        throw new Error("ENOENT: no such directory");
      });
      const runner = new ProcessRunner("real", makeLogger() as never);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("ignores non-.json files and already-completed manifests", () => {
      fsMocks.readdirSync.mockReturnValue(["notes.txt", "done.json"]);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ id: "done", completedAt: "2024-01-01" }));
      const runner = new ProcessRunner("real", makeLogger() as never);

      runner.rehydrateOrphans();

      // Only the .json manifest is read; the completed one is skipped before any liveness check.
      expect(fsMocks.readFileSync).toHaveBeenCalledTimes(1);
    });

    it("logs a warning and marks the manifest crashed when the pid is no longer alive", () => {
      fsMocks.readdirSync.mockReturnValue(["orphan.json"]);
      fsMocks.readFileSync.mockReturnValue(
        JSON.stringify({ id: "orphan", pid: 9999, stage: "executor", runtime: "claude-code" }),
      );
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never);

      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan", pid: 9999 }),
        "Orphaned agent process is dead, marking crashed",
      );
      expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("orphan.json"),
        expect.stringContaining('"crashed": true') as unknown as string,
      );
      killSpy.mockRestore();
    });

    it("rehydrates a live orphan: registers it as active and emits process:started", () => {
      fsMocks.readdirSync.mockReturnValue(["live.json"]);
      fsMocks.readFileSync.mockImplementation((path: string) => {
        if (String(path).endsWith(".json")) {
          return JSON.stringify({
            id: "live",
            pid: 1234,
            command: "claude",
            runId: "run-9",
            stage: "executor",
            runtime: "claude-code",
            startedAt: new Date().toISOString(),
          });
        }
        return "existing log content";
      });
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      const watcher = { close: vi.fn() };
      fsMocks.watch.mockReturnValue(watcher);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter);

      runner.rehydrateOrphans();

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-9",
        "live",
        "executor",
        "claude-code",
        "claude",
      );
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(runner.getProcessOutput("live")).toBe("existing log content");
      expect(fsMocks.watch).toHaveBeenCalledWith(expect.stringContaining("live.log"), expect.any(Function));
      killSpy.mockRestore();
    });

    it("tolerates a missing log file when rehydrating (no prior rollingBuffer)", () => {
      fsMocks.readdirSync.mockReturnValue(["live.json"]);
      let call = 0;
      fsMocks.readFileSync.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return JSON.stringify({
            id: "live",
            pid: 1234,
            command: "claude",
            runId: "run-9",
            stage: "executor",
            runtime: "claude-code",
            startedAt: new Date().toISOString(),
          });
        }
        throw new Error("no log file yet");
      });
      vi.spyOn(process, "kill").mockImplementation(() => true);
      fsMocks.watch.mockReturnValue({ close: vi.fn() });
      const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getProcessOutput("live")).toBe("");
    });

    it("logs a warning and continues when a manifest file is malformed JSON", () => {
      fsMocks.readdirSync.mockReturnValue(["bad.json"]);
      fsMocks.readFileSync.mockReturnValue("{not valid json");
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never);

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "bad.json" }),
        "Failed to process manifest",
      );
    });

    describe("orphan log tailing and poll loop", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      function setupLiveOrphan() {
        fsMocks.readdirSync.mockReturnValue(["live.json"]);
        fsMocks.readFileSync.mockImplementation((path: string) => {
          if (String(path).endsWith(".json")) {
            return JSON.stringify({
              id: "live",
              pid: 1234,
              command: "claude",
              runId: "run-9",
              stage: "executor",
              runtime: "claude-code",
              startedAt: new Date().toISOString(),
            });
          }
          return "";
        });
        const watcher = { close: vi.fn() };
        fsMocks.watch.mockReturnValue(watcher);
        return watcher;
      }

      it("appends new log content to the active buffer when the watched file changes", () => {
        const watcher = setupLiveOrphan();
        vi.spyOn(process, "kill").mockImplementation(() => true);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());
        runner.rehydrateOrphans();

        const watchCallback = fsMocks.watch.mock.calls[0]![1] as () => void;
        fsMocks.readFileSync.mockImplementation((path: string) =>
          String(path).endsWith(".json") ? "{}" : "grown content",
        );
        watchCallback();

        expect(runner.getProcessOutput("live")).toBe("grown content");
        expect(watcher.close).not.toHaveBeenCalled();
      });

      it("closes the watcher without throwing when the entry has already been removed", () => {
        setupLiveOrphan();
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());
        runner.rehydrateOrphans();

        const watcher = fsMocks.watch.mock.results[0]!.value as { close: ReturnType<typeof vi.fn> };
        // Kill the poll loop so the orphan is finalized and removed from activeProcesses.
        killSpy.mockImplementation(() => {
          throw new Error("ESRCH");
        });
        vi.advanceTimersByTime(5_000);
        expect(watcher.close).toHaveBeenCalled();

        // Firing the (now-closed) watch callback again must not throw and must re-close.
        const watchCallback = fsMocks.watch.mock.calls[0]![1] as () => void;
        expect(() => watchCallback()).not.toThrow();
        expect(watcher.close).toHaveBeenCalledTimes(2);
      });

      it("swallows a read error inside the watch callback", () => {
        const watcher = setupLiveOrphan();
        vi.spyOn(process, "kill").mockImplementation(() => true);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());
        runner.rehydrateOrphans();

        const watchCallback = fsMocks.watch.mock.calls[0]![1] as () => void;
        fsMocks.readFileSync.mockImplementation((path: string) => {
          if (String(path).endsWith(".json")) return "{}";
          throw new Error("read error");
        });
        expect(() => watchCallback()).not.toThrow();
        expect(watcher.close).not.toHaveBeenCalled();
      });

      it("keeps polling while the pid stays alive, then finalizes once it dies", () => {
        const watcher = setupLiveOrphan();
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        const emitter = makeEmitter();
        const runner = new ProcessRunner("real", makeLogger() as never, emitter);
        runner.rehydrateOrphans();

        expect(runner.getActiveProcesses()).toHaveLength(1);

        // Still alive: interval keeps running, nothing finalized.
        vi.advanceTimersByTime(5_000);
        expect(runner.getActiveProcesses()).toHaveLength(1);
        expect(watcher.close).not.toHaveBeenCalled();

        // Now the pid is gone.
        killSpy.mockImplementation(() => {
          throw new Error("ESRCH");
        });
        fsMocks.readFileSync.mockReturnValue(
          JSON.stringify({ id: "live", pid: 1234, runId: "run-9" }),
        );
        vi.advanceTimersByTime(5_000);

        expect(watcher.close).toHaveBeenCalled();
        expect(runner.getActiveProcesses()).toHaveLength(0);
        expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
          "run-9",
          "live",
          "executor",
          "claude-code",
          -1,
          expect.any(Number) as unknown as number,
        );
      });

      it("best-effort skips the manifest rewrite in finalizeOrphan when it cannot be read", () => {
        setupLiveOrphan();
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());
        runner.rehydrateOrphans();

        killSpy.mockImplementation(() => {
          throw new Error("ESRCH");
        });
        fsMocks.readFileSync.mockImplementation(() => {
          throw new Error("manifest gone");
        });

        expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
        expect(runner.getActiveProcesses()).toHaveLength(0);
      });

      it("stringifies a non-Error thrown value in the malformed-manifest catch", () => {
        fsMocks.readdirSync.mockReturnValue(["bad.json"]);
        fsMocks.readFileSync.mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "raw string throw";
        });
        const logger = makeLogger();
        const runner = new ProcessRunner("real", logger as never);

        runner.rehydrateOrphans();

        expect(logger.warn).toHaveBeenCalledWith(
          { file: "bad.json", error: "raw string throw" },
          "Failed to process manifest",
        );
      });

      it("falls back to pid 0 in the poll's liveness check once the active entry has already been removed", () => {
        const watcher = setupLiveOrphan();
        const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
          if (pid === 0) throw new Error("kill(0, 0): ESRCH");
          return true;
        });
        const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter());
        runner.rehydrateOrphans();

        // Reach into the private map the way the RealLinearClient tests reach
        // into RealLinearClient's private `sdk` field, to simulate the entry
        // having already been cleaned up by another path while the poll
        // interval is still armed (activeProcesses is a private field only
        // at the type level -- at runtime it's an ordinary property).
        (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
          "live",
        );

        expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
        expect(killSpy).toHaveBeenCalledWith(0, 0);
        // The pid falls back to 0 (via `?.pid ?? 0`), kill(0, 0) throws, and
        // the poll's catch branch runs its cleanup even though finalizeOrphan
        // itself is then a no-op (the entry is already gone).
        expect(watcher.close).toHaveBeenCalled();
      });
    });
  });

  describe("defensive early-return guards", () => {
    it("cleanupProcess is a no-op if the process entry was already removed (double-cleanup)", async () => {
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter, "/spool");

      const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };
      const promise = runner.execute({ ...baseOptions, context });

      // First cleanup: the child errors, which cleans up and removes the entry.
      const err = new Error("boom");
      child.emit("error", err);
      await expect(promise).rejects.toBe(err);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

      // A subsequent 'close' event (real child_process can still emit one
      // after 'error') re-invokes cleanupProcess for the same processId --
      // it must find the entry already gone and do nothing further.
      expect(() => child.emit("close", 0)).not.toThrow();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    });
  });
});
