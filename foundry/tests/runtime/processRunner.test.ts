import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessResult } from "../../src/runtime/runnerTypes.js";

// processRunner.ts spawns real subprocesses via node:child_process in "real"
// mode. We mock that module so no subprocess is ever actually executed, and
// partially mock node:fs's `watch` so orphan-tailing tests are deterministic
// (everything else in node:fs — mkdirSync/readFileSync/writeFileSync/
// readdirSync/existsSync/createWriteStream — stays real, against a throwaway
// temp directory used as the spool dir).

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

type WatchCallback = (eventType: string, filename: string | null) => void;
interface FakeWatcher {
  close: ReturnType<typeof vi.fn>;
}
const watchMock = vi.fn<(path: string, cb: WatchCallback) => FakeWatcher>();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: (path: string, cb: WatchCallback) => watchMock(path, cb),
  };
});

// Imported after the mocks above are registered.
const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

let spoolDir: string;

beforeEach(() => {
  spawnMock.mockReset();
  watchMock.mockReset();
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
});

afterEach(() => {
  vi.useRealTimers();
  // Intentionally not rmSync'ing spoolDir here: some code paths under test
  // (createWriteStream for logs) open the log file asynchronously, and a
  // synchronous rmSync immediately after the test can race that open and
  // surface as an unhandled ENOENT on the stream. These are throwaway
  // mkdtempSync directories under the OS tmp dir; leaving them for the OS
  // to reclaim avoids the race entirely.
});

const baseOptions: ProcessSpawnOptions = {
  command: "claude",
  args: ["--version"],
  cwd: "/tmp",
  timeoutMs: 5_000,
};

describe("ProcessRunner — constructor defaults", () => {
  it("defaults the spool directory to .foundry/processes (relative to cwd) when none is given", () => {
    const foundryDir = join(process.cwd(), ".foundry");
    const defaultDir = join(foundryDir, "processes");
    const foundryExistedBefore = existsSync(foundryDir);
    const defaultDirExistedBefore = existsSync(defaultDir);
    try {
      expect(() => new ProcessRunner("mock", makeMockLogger() as never)).not.toThrow();
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      // Only clean up what this test itself created, never anything that
      // was already on disk before it ran.
      if (!defaultDirExistedBefore) {
        rmSync(defaultDir, { recursive: true, force: true });
      }
      if (!foundryExistedBefore) {
        rmSync(foundryDir, { recursive: true, force: true });
      }
    }
  });
});

describe("ProcessRunner — mock mode", () => {
  it("delegates execute() to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const fakeResult: ProcessResult = {
      stdout: "hello",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(fakeResult);
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions);

    expect(result).toBe(fakeResult);
    expect(handler).toHaveBeenCalledWith(baseOptions);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when mock mode is enabled but no handler was configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);

    await expect(runner.execute(baseOptions)).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });
});

describe("ProcessRunner — real mode, happy paths", () => {
  it("spawns the command with merged env, writes stdinData, and resolves with collected stdout/stderr on a zero exit", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      env: { FOO: "bar" },
      stdinData: "the prompt",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      ["--version"],
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({ FOO: "bar" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith("the prompt");
    expect(child.stdin.end).toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from("out-chunk"));
    child.stderr.emit("data", Buffer.from("err-chunk"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "out-chunk",
      stderr: "err-chunk",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", exitCode: 0 }),
      "Process completed",
    );
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions);
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("resolves (does not reject) on a non-zero exit code, passing the exit code through", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions);
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("treats a null close code as exit code 1", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions);
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an 'error' event", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions);
    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });
});

describe("ProcessRunner — timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM when the timeout elapses, then SIGKILL after the grace period if still not killed, and rejects with AgentTimeoutError", async () => {
    const child = new FakeChildProcess();
    // Simulate a process that ignores SIGTERM (never sets killed=true via kill()).
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", timeoutMs: 1_000 }),
      "Process timed out",
    );
  });

  it("does not escalate to SIGKILL if the process reports killed=true after SIGTERM", async () => {
    const child = new FakeChildProcess(); // kill() sets killed=true
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    const killCallsBefore = child.kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    // Still only the one SIGTERM call -- no SIGKILL was issued.
    expect(child.kill.mock.calls.length).toBe(killCallsBefore);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses the bare command as the timeout error label when no context is provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    try {
      await promise;
      expect.fail("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentTimeoutError);
      expect((err as AgentTimeoutError).agent).toBe("claude");
    }
  });

  it("uses '<runtime>/<stage>' as the timeout error label when context is provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      timeoutMs: 500,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    try {
      await promise;
      expect.fail("should have rejected");
    } catch (err) {
      expect((err as AgentTimeoutError).agent).toBe("claude-code/planner");
    }
  });

  it("does not reject with AgentTimeoutError when the process closes before the timeout fires", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

describe("ProcessRunner — active process tracking (context provided)", () => {
  it("tracks a started process in getActiveProcesses(), writes a manifest, and notifies the emitter", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.id).toBe("string");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({ pid: child.pid, runId: "run-1", stage: "planner" });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      "claude",
    );

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeTruthy();
    expect(finalManifest.exitCode).toBe(0);
  });

  it("does not create a tracked entry when context is provided but child.pid is falsy", async () => {
    const child = new FakeChildProcess();
    child.pid = undefined as unknown as number;
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    child.emit("close", 0);
    await promise;
  });

  it("cleans up the tracked process and writes a manifest update when the child errors out", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;

    const err = new Error("boom");
    child.emit("error", err);
    await expect(promise).rejects.toBe(err);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("swallows a manifest write error in cleanupProcess when the manifest file has disappeared", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-2", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;
    rmSync(join(spoolDir, `${processId}.json`), { force: true });

    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ exitCode: 0 });

    // Despite the manifest being gone, cleanup still ran and notified the
    // emitter -- only the on-disk manifest update was skipped.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-2",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("appends stdout/stderr chunks to the rolling buffer and the log file as they arrive", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;

    child.stdout.emit("data", Buffer.from("hello "));
    child.stderr.emit("data", Buffer.from("world"));

    expect(runner.getProcessOutput(processId)).toBe("hello world");

    child.emit("close", 0);
    await promise;

    const logPath = join(spoolDir, `${processId}.log`);
    // The underlying WriteStream opens its fd asynchronously; poll briefly
    // for the file to actually land on disk instead of racing a fixed wait.
    await vi.waitFor(() => expect(existsSync(logPath)).toBe(true), { timeout: 2000 });
  });
});

describe("ProcessRunner — appendToBuffer throttling and truncation", () => {
  it("throttles emitProcessOutput calls to at most once per OUTPUT_THROTTLE_MS window", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    // Two chunks emitted back-to-back (same tick): only the first should
    // trigger emitProcessOutput since the second arrives well under the
    // 250ms throttle window.
    child.stdout.emit("data", Buffer.from("chunk-1"));
    child.stdout.emit("data", Buffer.from("chunk-2"));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "chunk-1",
    );

    child.emit("close", 0);
    await promise;
  });

  it("slices an emitted chunk to its last 500 characters when longer", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const longChunk = "x".repeat(600) + "[TAIL]";
    child.stdout.emit("data", Buffer.from(longChunk));

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(emittedChunk.length).toBe(500);
    expect(emittedChunk).toContain("[TAIL]");

    child.emit("close", 0);
    await promise;
  });

  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX (8KB) bytes", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;

    const big = "a".repeat(8 * 1024);
    child.stdout.emit("data", Buffer.from(big));
    child.stdout.emit("data", Buffer.from("[MARKER]"));

    const buffer = runner.getProcessOutput(processId);
    expect(buffer!.length).toBeLessThanOrEqual(8 * 1024);
    expect(buffer).toContain("[MARKER]");

    child.emit("close", 0);
    await promise;
  });

  it("does not attempt to emit output when no emitter is configured", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(() => child.stdout.emit("data", Buffer.from("hi"))).not.toThrow();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null when the process is not active and no log file exists on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads and tail-truncates from the on-disk log file when the process is no longer active", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const content = "y".repeat(9 * 1024) + "[END]";
    writeFileSync(join(spoolDir, "finished-id.log"), content);

    const output = runner.getProcessOutput("finished-id");
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toContain("[END]");
  });

  it("returns null when the log file exists but cannot be read (e.g. is a directory)", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    mkdirSync(join(spoolDir, "dir-id.log"));

    expect(runner.getProcessOutput("dir-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const missingDir = join(spoolDir, "does-not-exist");
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, missingDir);
    rmSync(missingDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files and manifests that are already completed", () => {
    writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 99999,
        command: "claude",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: "x",
        completedAt: new Date().toISOString(),
      }),
    );
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 123456,
        command: "claude",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead.log"),
      }),
    );
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: 123456 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeTruthy();

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphan: tracks it, tails its log, and finalizes it once the pid disappears", () => {
    vi.useFakeTimers();

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });

    const logPath = join(spoolDir, "orphan.log");
    writeFileSync(logPath, "initial log content\n");
    writeFileSync(
      join(spoolDir, "orphan.json"),
      JSON.stringify({
        id: "orphan",
        pid: 777,
        command: "claude",
        args: [],
        runId: "run-x",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher: FakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan", pid: 777 }),
      "Rehydrating orphaned agent process",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("orphan")).toBe("initial log content\n");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-x",
      "orphan",
      "executor",
      "claude-code",
      "claude",
    );
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));
    const watchCallback = watchMock.mock.calls[0]![1];

    // Simulate the log file growing and the watcher firing: the new chunk
    // should be appended to the rolling buffer.
    writeFileSync(logPath, "initial log content\nmore output appended\n");
    watchCallback("change", "orphan.log");
    expect(runner.getProcessOutput("orphan")).toBe(
      "initial log content\nmore output appended\n",
    );

    // Now the pid disappears: the next 5s poll tick should detect it, clear
    // the interval, close the watcher, and finalize the orphan.
    alive = false;
    vi.advanceTimersByTime(5_000);

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-x",
      "orphan",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan", pid: 777 }),
      "Orphaned process has exited",
    );

    const finalManifest = JSON.parse(readFileSync(join(spoolDir, "orphan.json"), "utf-8"));
    expect(finalManifest.completedAt).toBeTruthy();
    expect(finalManifest.exitCode).toBe(-1);

    // The watch callback must be a no-op (and close its own watcher handle)
    // once the entry has already been removed.
    watchCallback("change", "orphan.log");
    expect(fakeWatcher.close).toHaveBeenCalledTimes(2);

    killSpy.mockRestore();
  });

  it("rehydrates an alive orphan whose log file does not exist yet (both the manifest-read and tail-start reads swallow ENOENT)", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const logPath = join(spoolDir, "no-log-yet.log");
    // Intentionally do NOT create logPath: both the rehydrate-time
    // "existing" read and tailLogForOrphan's initial size read must
    // swallow the resulting ENOENT and continue.
    writeFileSync(
      join(spoolDir, "no-log-yet.json"),
      JSON.stringify({
        id: "no-log-yet",
        pid: 779,
        command: "claude",
        args: [],
        runId: "run-z",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    watchMock.mockReturnValue({ close: vi.fn() });
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(runner.getProcessOutput("no-log-yet")).toBe("");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "no-log-yet" }),
      "Rehydrating orphaned agent process",
    );

    killSpy.mockRestore();
  });

  it("finalizeOrphan swallows a manifest read/write error when the manifest file has disappeared", () => {
    vi.useFakeTimers();
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });

    const logPath = join(spoolDir, "vanish.log");
    const manifestPath = join(spoolDir, "vanish.json");
    writeFileSync(logPath, "log\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "vanish",
        pid: 780,
        command: "claude",
        args: [],
        runId: "run-v",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    watchMock.mockReturnValue({ close: vi.fn() });
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Manifest disappears before the orphan is finalized.
    rmSync(manifestPath, { force: true });
    alive = false;

    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();

    // finalize still ran and notified the emitter, even though the
    // manifest update itself was a no-op.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-v",
      "vanish",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("the watch callback swallows a read error without throwing", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const logPath = join(spoolDir, "orphan2.log");
    writeFileSync(logPath, "hello\n");
    writeFileSync(
      join(spoolDir, "orphan2.json"),
      JSON.stringify({
        id: "orphan2",
        pid: 778,
        command: "claude",
        args: [],
        runId: "run-y",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher: FakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    const watchCallback = watchMock.mock.calls[0]![1];

    // Remove the log file out from under the watcher so the read inside the
    // callback throws; this must be swallowed, not propagated.
    rmSync(logPath, { force: true });
    expect(() => watchCallback("change", "orphan2.log")).not.toThrow();

    killSpy.mockRestore();
  });
});
