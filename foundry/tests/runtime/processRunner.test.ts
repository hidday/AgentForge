import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessContext } from "../../src/runtime/runnerTypes.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: (...args: unknown[]) => watchMock(...args),
  };
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

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.killed = false;
  child.kill = vi.fn((_signal?: string) => {
    child.killed = true;
    return true;
  });
  return child;
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "some-cli",
    args: ["--flag"],
    cwd: "/tmp",
    timeoutMs: 60_000,
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (!predicate()) {
    throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
  }
}

let spoolDir: string;

beforeEach(() => {
  spawnMock.mockReset();
  watchMock.mockReset();
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
});

afterEach(async () => {
  vi.useRealTimers();
  // createWriteStream() opens its file descriptor asynchronously. If the
  // spool directory is removed before that open completes, the stream emits
  // an unhandled 'error' (the source never attaches a listener for it) after
  // the test has already finished. Give any pending opens a moment to
  // settle before tearing down the directory.
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner constructor", () => {
  it("creates the spool directory if it does not already exist", () => {
    const target = join(spoolDir, "nested", "spool");
    expect(existsSync(target)).toBe(false);
    // eslint-disable-next-line no-new
    new ProcessRunner("mock", makeMockLogger() as never, undefined, target);
    expect(existsSync(target)).toBe(true);
  });
});

describe("ProcessRunner execute() — mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and logs a debug line", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handlerResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const options = baseOptions({ command: "mocked-cli", args: ["a", "b"] });
    const result = await runner.execute(options);

    expect(result).toBe(handlerResult);
    expect(handler).toHaveBeenCalledWith(options);
    expect(logger.debug).toHaveBeenCalledWith(
      { command: "mocked-cli", args: ["a", "b"], cwd: "/tmp" },
      "Executing mock process",
    );
  });
});

describe("ProcessRunner execute() — real mode, basic spawn behavior", () => {
  it("spawns with merged env/cwd, ends stdin immediately when no stdinData, and resolves on a clean exit", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ command: "echo", args: ["hi"], cwd: "/work", env: { FOO: "bar" } }),
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/work",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).not.toHaveBeenCalled();

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
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("writes stdinData then ends stdin when provided", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "prompt text" }));
    expect(child.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) with the non-zero exit code from the child", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the child closes with a null code", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an 'error' event", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    const spawnError = new Error("spawn ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });
});

describe("ProcessRunner execute() — real mode, process context tracking", () => {
  const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

  it("registers an active process entry, writes a manifest, and emits process:started when context is given", async () => {
    const child = makeFakeChild(9001);
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions({ command: "claude", context }));

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 9001,
      command: "claude",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.id).toBe("string");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({
      id: active[0]!.id,
      pid: 9001,
      command: "claude",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });

    child.emit("close", 0);
    await promise;

    // Process is no longer active, and the manifest reflects completion.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(0);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("still resolves cleanly when the manifest file is missing at completion time (best-effort update)", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions({ context }));
    const [{ id }] = runner.getActiveProcesses();
    rmSync(join(spoolDir, `${id}.json`));

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("cleans up the active process entry with exitCode -1 when the child errors out", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions({ context }));
    const [{ id }] = runner.getActiveProcesses();

    child.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("boom");

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("buffers stdout/stderr chunks into the rolling buffer and log file while active", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ context }));
    const [{ id }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("first chunk\n"));
    child.stderr.emit("data", Buffer.from("second chunk\n"));

    expect(runner.getProcessOutput(id)).toBe("first chunk\nsecond chunk\n");

    child.emit("close", 0);
    await promise;

    // After completion the entry is gone; getProcessOutput should now read
    // the persisted log file from disk. The underlying write stream flushes
    // asynchronously, so poll briefly rather than assuming it landed within
    // a single microtask tick.
    await waitFor(() => (runner.getProcessOutput(id) ?? "").includes("second chunk"));
    const fromDisk = runner.getProcessOutput(id);
    expect(fromDisk).toContain("first chunk");
    expect(fromDisk).toContain("second chunk");
  });

  it("truncates the in-memory rolling buffer to the last 8KB", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ context }));
    const [{ id }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("A".repeat(5000)));
    child.stdout.emit("data", Buffer.from("B".repeat(5000)));

    const buffered = runner.getProcessOutput(id)!;
    expect(buffered.length).toBe(8 * 1024);
    expect(buffered.endsWith("B".repeat(5000))).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions to once per 250ms and slices long chunks to 500 chars", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions({ context }));

    // First chunk: always emitted (lastEmitMs starts at 0).
    child.stdout.emit("data", Buffer.from("chunk-one"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-1",
      expect.any(String),
      "chunk-one",
    );

    // Second chunk immediately after: throttled, not emitted.
    child.stdout.emit("data", Buffer.from("chunk-two"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window; a long chunk should be sliced to 500 chars.
    await vi.advanceTimersByTimeAsync(300);
    const longChunk = "Z".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(emittedChunk).toBe(longChunk.slice(-500));
    expect(emittedChunk.length).toBe(500);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner execute() — real mode, timeout handling", () => {
  it("kills the child with SIGTERM on timeout, then SIGKILL after the grace period if still not killed, and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    // Simulate a child that does NOT actually die from SIGTERM.
    child.kill = vi.fn(() => true);
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ command: "hangs", timeoutMs: 1000 }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "hangs", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not send SIGKILL when the child reports killed:true after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    child.kill = vi.fn(() => {
      child.killed = true;
      return true;
    });
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1); // no SIGKILL

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("includes a context-derived label (runtime/stage) in the timeout error when context is present", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 500,
        context: { runId: "run-9", stage: "reviewer", runtime: "codex" },
      }),
    );

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    await expect(promise).rejects.toThrow(/codex\/reviewer/);
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null for an unknown process id with no log file on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads and tail-truncates a persisted log file for a process no longer active", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const longContent = "L".repeat(9000);
    writeFileSync(join(spoolDir, "orphan-1.log"), longContent);

    const output = runner.getProcessOutput("orphan-1");
    expect(output).toHaveLength(8 * 1024);
    expect(output).toBe(longContent.slice(-8 * 1024));
  });

  it("returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    // A directory at the expected log path exists but readFileSync on it throws.
    mkdirSync(join(spoolDir, "weird-id.log"));
    expect(runner.getProcessOutput("weird-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips manifests that are already marked completed", () => {
    writeFileSync(
      join(spoolDir, "done-1.json"),
      JSON.stringify({
        id: "done-1",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-1.log"),
        completedAt: new Date().toISOString(),
      }),
    );
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("logs a warning and skips a manifest file containing invalid JSON", () => {
    writeFileSync(join(spoolDir, "corrupt-1.json"), "{ not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt-1.json" }),
      "Failed to process manifest",
    );
  });

  it("marks an orphan as crashed when its pid is no longer alive", () => {
    const manifestPath = join(spoolDir, "dead-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-1",
        // A pid essentially guaranteed not to correspond to a live process.
        pid: 999_999_999,
        command: "claude",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-1.log"),
      }),
    );
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 999_999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
  });

  it("rehydrates a live orphan: registers it as active, emits process:started, and watches its log", () => {
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logPath = join(spoolDir, "alive-1.log");
    writeFileSync(logPath, "initial log content\n");
    const manifestPath = join(spoolDir, "alive-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive-1",
        pid: process.pid, // guaranteed alive: this test process itself
        command: "claude",
        args: [],
        runId: "run-7",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: process.pid, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-7",
      "alive-1",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("alive-1")).toBe("initial log content\n");
    expect(watchMock).toHaveBeenCalledTimes(1);
    expect(watchMock.mock.calls[0]![0]).toBe(logPath);
  });

  it("appends newly-written log content to the rolling buffer when the watch callback fires", () => {
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logPath = join(spoolDir, "alive-2.log");
    writeFileSync(logPath, "line one\n");
    writeFileSync(
      join(spoolDir, "alive-2.json"),
      JSON.stringify({
        id: "alive-2",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-8",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      makeMockEmitter() as never,
      spoolDir,
    );

    runner.rehydrateOrphans();
    const watchCallback = watchMock.mock.calls[0]![1] as () => void;

    writeFileSync(logPath, "line one\nline two\n");
    watchCallback();

    expect(runner.getProcessOutput("alive-2")).toBe("line one\nline two\n");
  });

  it("closes the watcher and does nothing when the watch callback fires after the entry is gone", () => {
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logPath = join(spoolDir, "alive-3.log");
    writeFileSync(logPath, "content\n");
    writeFileSync(
      join(spoolDir, "alive-3.json"),
      JSON.stringify({
        id: "alive-3",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-9",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      makeMockEmitter() as never,
      spoolDir,
    );

    runner.rehydrateOrphans();
    const watchCallback = watchMock.mock.calls[0]![1] as () => void;

    // Simulate the entry having already been finalized/removed elsewhere.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "alive-3",
    );

    expect(() => watchCallback()).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  it("silently tolerates a missing log file when starting to tail an orphan", () => {
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logPath = join(spoolDir, "no-log-yet.log"); // never created
    writeFileSync(
      join(spoolDir, "no-log-yet.json"),
      JSON.stringify({
        id: "no-log-yet",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-10",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      makeMockEmitter() as never,
      spoolDir,
    );

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
  });

  it("finalizes an orphan once the poll interval detects its process has died", async () => {
    vi.useFakeTimers();
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockReturnValue(fakeWatcher);

    const logPath = join(spoolDir, "alive-4.log");
    writeFileSync(logPath, "content\n");
    const manifestPath = join(spoolDir, "alive-4.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive-4",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-11",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // The poll interval calls process.kill(pid, 0); make it look alive once
    // more (the initial rehydrate check already consumed one alive check),
    // then dead on the interval's own check.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((
      pid: number,
      signal?: string | number,
    ) => {
      if (signal === 0) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { processId: "alive-4", pid: process.pid },
      "Orphaned process has exited",
    );
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-11",
      "alive-4",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBe(-1);
    expect(finalManifest.completedAt).toBeDefined();

    killSpy.mockRestore();
  });
});
