import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn() };
});

import { spawn } from "node:child_process";
import { watch } from "node:fs";

const mockedSpawn = vi.mocked(spawn);
const mockedWatch = vi.mocked(watch);

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
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid = 4321, killTakesEffect = true): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn(() => {
    if (killTakesEffect) child.killed = true;
    return true;
  });
  return child;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  mockedSpawn.mockReset();
  mockedWatch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Note: we deliberately do NOT rmSync the per-test spool directory here.
  // ProcessRunner opens log files via createWriteStream, whose underlying
  // fs.open() completes asynchronously (via libuv's threadpool); removing
  // the directory synchronously right after the test can race that open
  // and surface as an unhandled ENOENT error attributed to a later test.
  // Each test uses its own uniquely-named directory under the OS tmpdir,
  // so leaving them behind is harmless and avoids that flakiness.
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory eagerly", () => {
    const nested = join(spoolDir, "nested", "dir");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("real", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner.execute — mock mode", () => {
  it("rejects when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "out",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const opts: ProcessSpawnOptions = {
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(opts);

    expect(handler).toHaveBeenCalledWith(opts);
    expect(result.stdout).toBe("out");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", args: ["--version"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner.execute — real mode, success and failure paths", () => {
  it("spawns the child with merged env/cwd/stdio and resolves stdout/stderr/exitCode on a clean exit", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 5000,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
    expect(child.stdin.end).toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from("out1"));
    child.stderr.emit("data", Buffer.from("err1"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "out1",
      stderr: "err1",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("writes stdinData to the child's stdin and ends it", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "hello stdin",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) with the non-zero exit code on a normal failing exit", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the spawn error when the child emits an 'error' event (e.g. ENOENT)", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    const err = Object.assign(new Error("spawn does-not-exist ENOENT"), { code: "ENOENT" });
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("cleans up the active-process entry and emits completion (exitCode -1) when a tracked process errors", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    // Entry should be tracked and manifest written before the error occurs.
    const [active] = runner.getActiveProcesses();
    expect(active).toMatchObject({ command: "does-not-exist", runId: "run-1", stage: "planner" });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active.id,
      "planner",
      "claude-code",
      "does-not-exist",
    );

    const err = new Error("spawn ENOENT");
    child.emit("error", err);
    await expect(promise).rejects.toBe(err);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active.id,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );

    const manifest = JSON.parse(readFileSync(join(spoolDir, `${active.id}.json`), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toEqual(expect.any(String));
  });

  it("still emits completion and does not throw when the manifest file is missing at cleanup time", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1b", stage: "planner", runtime: "claude-code" },
    });
    const [active] = runner.getActiveProcesses();

    // Manifest disappears before the process completes -- the best-effort
    // manifest rewrite in cleanupProcess() must swallow the read/parse error.
    rmSync(join(spoolDir, `${active.id}.json`));

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1b",
      active.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(existsSync(join(spoolDir, `${active.id}.json`))).toBe(false);
  });

  it("kills with SIGTERM on timeout and rejects with AgentTimeoutError once the process actually exits", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild(1111, true);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-2", stage: "executor", runtime: "codex" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Process actually terminates in response to SIGTERM.
    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    await expect(promise).rejects.toThrow(/codex\/executor/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "sleep", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL after 5s when SIGTERM does not stop the process", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild(2222, false); // kill() never flips `killed`
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses the bare command as the timeout error label when no context is provided", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "my-cli", args: [], cwd: "/tmp", timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    child.emit("close", null);

    await expect(promise).rejects.toThrow(/my-cli/);
  });
});

describe("ProcessRunner active-process tracking and output buffering", () => {
  it("getActiveProcesses reports elapsedMs and exposes the tracked shape while a process is running", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "claude",
      runId: "run-3",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(typeof active[0]!.startedAt).toBe("string");

    child.emit("close", 0);
    await promise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("getProcessOutput returns the live rolling buffer for an active process", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-4", stage: "planner", runtime: "claude-code" },
    });
    const [{ id }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("partial output so far"));
    expect(runner.getProcessOutput(id)).toBe("partial output so far");

    child.emit("close", 0);
    await promise;
  });

  it("trims the rolling buffer to the last 8KB when output exceeds the cap", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-5", stage: "planner", runtime: "claude-code" },
    });
    const [{ id }] = runner.getActiveProcesses();

    const big = "A".repeat(9000);
    child.stdout.emit("data", Buffer.from(big));
    const buffered = runner.getProcessOutput(id);
    expect(buffered).toHaveLength(8 * 1024);
    expect(buffered).toBe(big.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emission to once per 250ms and truncates each emitted chunk to 500 chars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-6", stage: "planner", runtime: "claude-code" },
    });
    const [{ id }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenNthCalledWith(1, "run-6", id, "first");

    // Same instant: throttled, should NOT emit again.
    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window.
    vi.setSystemTime(1_000_300);
    const longChunk = "X".repeat(550) + "TAIL";
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    expect(emitter.emitProcessOutput).toHaveBeenNthCalledWith(
      2,
      "run-6",
      id,
      longChunk.slice(-500),
    );

    child.emit("close", 0);
    await promise;
  });

  it("does not throw and skips emission when no emitter is configured", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-7", stage: "planner", runtime: "claude-code" },
    });

    expect(() => child.stdout.emit("data", Buffer.from("no emitter here"))).not.toThrow();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput — non-active processes", () => {
  it("reads the tail of the on-disk log file when the process is no longer active", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const processId = "finished-proc";
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(spoolDir, `${processId}.log`), content, "utf-8");

    expect(runner.getProcessOutput(processId)).toBe(content.slice(-8 * 1024));
  });

  it("returns null when neither an active entry nor a log file exists", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent")).toBeNull();
  });

  it("returns null (swallowing the error) when the on-disk log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const processId = "broken-proc";
    // existsSync() is true for a directory, but readFileSync() on a directory
    // throws EISDIR -- exercises the catch branch around the log-file read.
    mkdirSync(join(spoolDir, `${processId}.log`));

    expect(runner.getProcessOutput(processId)).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  function writeManifest(id: string, overrides: Record<string, unknown> = {}) {
    const manifest = {
      id,
      pid: 9999,
      command: "claude",
      args: ["--print"],
      runId: "orphan-run",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, `${id}.log`),
      ...overrides,
    };
    writeFileSync(join(spoolDir, `${id}.json`), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  it("does nothing when the spool directory is empty", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("returns silently when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already completed", () => {
    writeManifest("done-1", { completedAt: new Date().toISOString(), exitCode: 0 });
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("logs a warning and skips a manifest file with unparseable JSON", () => {
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const manifest = writeManifest("dead-1");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: manifest.pid }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const rewritten = JSON.parse(readFileSync(join(spoolDir, "dead-1.json"), "utf-8"));
    expect(rewritten.crashed).toBe(true);
    expect(rewritten.exitCode).toBe(-1);
    expect(rewritten.completedAt).toEqual(expect.any(String));
  });

  it("rehydrates a live orphan into the active-process map and emits process:started", () => {
    mockedWatch.mockReturnValue({ close: vi.fn() } as never);
    const manifest = writeManifest("alive-1");
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: manifest.pid }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "orphan-run",
      "alive-1",
      "planner",
      "claude-code",
      "claude",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive-1", pid: manifest.pid, runId: "orphan-run" });
    expect(mockedWatch).toHaveBeenCalledWith(join(spoolDir, "alive-1.log"), expect.any(Function));
  });

  it("picks up an existing log tail on rehydrate and appends new content via the fs.watch callback", () => {
    let watchCallback: (() => void) | undefined;
    mockedWatch.mockImplementation((_path, cb) => {
      watchCallback = cb as () => void;
      return { close: vi.fn() } as never;
    });

    const logPath = join(spoolDir, "alive-2.log");
    writeFileSync(logPath, "existing-tail");
    writeManifest("alive-2");
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("alive-2")).toBe("existing-tail");

    // Simulate the log file growing; fs.watch would fire our captured callback.
    writeFileSync(logPath, "more-data", { flag: "a" });
    expect(watchCallback).toBeTypeOf("function");
    watchCallback!();

    expect(runner.getProcessOutput("alive-2")).toBe("existing-tailmore-data");
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "orphan-run",
      "alive-2",
      "more-data",
    );
  });

  it("ignores a read error inside the fs.watch callback (e.g. the log file disappearing mid-tail)", () => {
    let watchCallback: (() => void) | undefined;
    mockedWatch.mockImplementation((_path, cb) => {
      watchCallback = cb as () => void;
      return { close: vi.fn() } as never;
    });

    const logPath = join(spoolDir, "alive-4.log");
    writeFileSync(logPath, "existing-tail");
    writeManifest("alive-4");
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(watchCallback).toBeTypeOf("function");

    // The log file vanishes before the watch callback re-reads it.
    rmSync(logPath);
    expect(() => watchCallback!()).not.toThrow();

    // No new output was appended, so nothing further was emitted.
    expect(emitter.emitProcessOutput).not.toHaveBeenCalled();
  });

  it("closes the watcher and returns early when the fs.watch callback fires after the process entry is gone", () => {
    let watchCallback: (() => void) | undefined;
    const closeSpy = vi.fn();
    mockedWatch.mockImplementation((_path, cb) => {
      watchCallback = cb as () => void;
      return { close: closeSpy } as never;
    });

    writeManifest("alive-5");
    const killSpy = vi.spyOn(process, "kill");
    killSpy.mockImplementation(() => true as never);
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    expect(watchCallback).toBeTypeOf("function");

    // Simulate the orphan already having been finalized/removed by some
    // other path (e.g. concurrently), so the entry is gone by the time the
    // watch callback fires.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5_000);
    expect(runner.getActiveProcesses()).toHaveLength(0);

    expect(() => watchCallback!()).not.toThrow();
    // finalizeOrphan's own watcher.close() plus this early-return close() call.
    expect(closeSpy).toHaveBeenCalled();
  });

  it("finalizes an orphan as crashed (exitCode -1) once its poll interval detects the pid has died", () => {
    vi.useFakeTimers();
    const closeSpy = vi.fn();
    mockedWatch.mockReturnValue({ close: closeSpy } as never);
    const manifest = writeManifest("alive-3");

    const killSpy = vi.spyOn(process, "kill");
    killSpy.mockImplementation(() => true as never); // alive during rehydrate

    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Now the pid is gone: the 5s poll should detect it and finalize.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5_000);

    expect(closeSpy).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "orphan-run",
      "alive-3",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-3", pid: manifest.pid }),
      "Orphaned process has exited",
    );

    const rewritten = JSON.parse(readFileSync(join(spoolDir, "alive-3.json"), "utf-8"));
    expect(rewritten.exitCode).toBe(-1);
    expect(rewritten.completedAt).toEqual(expect.any(String));
  });

  it("still emits completion when finalizing an orphan whose manifest file is missing", () => {
    vi.useFakeTimers();
    mockedWatch.mockReturnValue({ close: vi.fn() } as never);
    writeManifest("alive-6");

    const killSpy = vi.spyOn(process, "kill");
    killSpy.mockImplementation(() => true as never);

    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Manifest disappears before the poll notices the pid has died -- the
    // best-effort manifest rewrite in finalizeOrphan() must swallow this.
    rmSync(join(spoolDir, "alive-6.json"));

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "orphan-run",
      "alive-6",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});
