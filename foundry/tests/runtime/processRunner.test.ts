import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock node:child_process so no real processes are ever spawned.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ProcessRunner, type MockProcessHandler } from "../../src/runtime/processRunner.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

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

/** A fake child_process.ChildProcess good enough to drive ProcessRunner's executeReal(). */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid: number | undefined = 4242;
  killed = false;
  kill = vi.fn((signal?: string) => {
    this.killed = true;
    return true;
  });
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  vi.mocked(spawn).mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // createWriteStream()'s open is asynchronous; give any in-flight log-file
  // opens/writes from this test a chance to settle before the spool dir is
  // removed, so they don't surface as unhandled errors during a later test
  // (this needs more headroom under full-suite load than in isolation).
  await new Promise((resolve) => setTimeout(resolve, 150));
  rmSync(spoolDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const baseOptions: ProcessSpawnOptions = {
  command: "some-cli",
  args: ["--flag"],
  cwd: "/tmp",
  timeoutMs: 5000,
};

describe("ProcessRunner — mock mode", () => {
  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler: MockProcessHandler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions);

    expect(handler).toHaveBeenCalledWith(baseOptions);
    expect(result.stdout).toBe("mocked");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", args: ["--flag"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });

  it("throws when mock mode is enabled but no handler has been configured", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

    await expect(runner.execute(baseOptions)).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });
});

describe("ProcessRunner — executeReal success paths", () => {
  it("spawns the subprocess, captures stdout/stderr, and resolves with the exit code on close", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ ...baseOptions, env: { FOO: "bar" } });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: x"));
    child.emit("close", 0);

    const result = await promise;

    expect(result).toMatchObject({ stdout: "hello world", stderr: "warn: x", exitCode: 0, timedOut: false });
    expect(typeof result.durationMs).toBe("number");

    expect(spawn).toHaveBeenCalledWith(
      "some-cli",
      ["--flag"],
      expect.objectContaining({
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.anything(), "Process completed");
  });

  it("writes stdinData to the child's stdin and ends it", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ ...baseOptions, stdinData: "the prompt" });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("the prompt");
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("resolves with a non-zero exit code rather than rejecting", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when close reports a null code", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });
});

describe("ProcessRunner — executeReal error path", () => {
  it("rejects when the child process emits an 'error' event (e.g. spawn failure)", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute(baseOptions);
    const spawnError = new Error("ENOENT: no such file or directory, spawn some-cli");
    child.emit("error", spawnError);

    await expect(promise).rejects.toBe(spawnError);
  });

  it("cleans up the tracked process when spawn errors after a context was registered", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(1);

    child.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("boom");

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
});

describe("ProcessRunner — timeout handling", () => {
  it("kills the process with SIGTERM on timeout, then SIGKILL if it hasn't died, and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    // Simulate a process that ignores SIGTERM (does not actually die).
    child.kill = vi.fn(() => true);
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not escalate to SIGKILL when the process reports killed after SIGTERM", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild(); // default kill() sets this.killed = true

    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 500 });

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("clears the timeout and does not reject with AgentTimeoutError when the process finishes before the deadline", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 5000 });
    child.emit("close", 0);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    // Advancing well past the timeout afterward must not retroactively kill anything.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — process tracking with context", () => {
  it("registers an active process, writes a manifest, emits started, and tracks elapsed time", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    child.pid = 999;
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-7", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 999,
      command: "some-cli",
      runId: "run-7",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.id).toBe("string");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-7",
      active[0]!.id,
      "planner",
      "claude-code",
      "some-cli",
    );

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({ pid: 999, runId: "run-7", stage: "planner", runtime: "claude-code" });

    child.emit("close", 0);
    await promise;

    // Process is cleaned up from the active set, and the manifest is finalized.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeTruthy();
    expect(finalManifest.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-7",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("does not register a tracked process when no context is provided", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute(baseOptions);
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not register a tracked process when the child has no pid", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-9", stage: "planner", runtime: "claude-code" },
    });
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    // cleanupProcess is still invoked (processId truthy) but finds no entry and no-ops.
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("works without an emitter (optional) when tracking a process", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-5", stage: "planner", runtime: "codex" },
    });
    expect(runner.getActiveProcesses()).toHaveLength(1);

    child.stdout.emit("data", Buffer.from("output chunk"));
    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("gracefully tolerates a missing manifest file when finalizing a tracked process", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-3", stage: "planner", runtime: "claude-code" },
    });
    const active = runner.getActiveProcesses();
    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    unlinkSync(manifestPath); // simulate the manifest disappearing before completion

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // Completion is still emitted even though the on-disk manifest update failed.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-3",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner — output buffering and throttling", () => {
  it("rolls the in-memory buffer over to only the last ROLLING_BUFFER_MAX (8KB) characters", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    const big = "a".repeat(5000);
    child.stdout.emit("data", Buffer.from(big));
    child.stdout.emit("data", Buffer.from(big));
    child.stdout.emit("data", Buffer.from("TAIL_MARKER"));

    const buffered = runner.getProcessOutput(active[0]!.id);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBeLessThanOrEqual(8 * 1024);
    expect(buffered!.endsWith("TAIL_MARKER")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("emits at most one process:output event for a burst of rapid chunks (throttled)", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-2", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("chunk 1"));
    child.stdout.emit("data", Buffer.from("chunk 2"));
    child.stdout.emit("data", Buffer.from("chunk 3"));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-2",
      expect.any(String),
      "chunk 1",
    );

    child.emit("close", 0);
    await promise;
  });

  it("slices an overly long chunk to its last 500 characters before emitting", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-4", stage: "planner", runtime: "claude-code" },
    });

    const long = "x".repeat(600) + "END";
    child.stdout.emit("data", Buffer.from(long));

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(emittedChunk.length).toBe(500);
    expect(emittedChunk.endsWith("END")).toBe(true);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns the live rolling buffer for an active process", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    const active = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("live output"));

    expect(runner.getProcessOutput(active[0]!.id)).toBe("live output");

    child.emit("close", 0);
    await promise;
  });

  it("falls back to the on-disk log file (tail) once the process is no longer active", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const processId = "offline-proc";
    writeFileSync(join(spoolDir, `${processId}.log`), "a".repeat(9000) + "TAIL");

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output!.endsWith("TAIL")).toBe(true);
  });

  it("returns null when neither an active entry nor a log file exists", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(runner.getProcessOutput("nonexistent-proc")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read as a file", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const processId = "bad-log";
    // Make the "log file" a directory so existsSync is true but readFileSync throws.
    mkdirSync(join(spoolDir, `${processId}.log`));

    expect(runner.getProcessOutput(processId)).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("does nothing when the spool directory cannot be read", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({ id: "done", pid: 1, command: "x", args: [], runId: "r", stage: "s", runtime: "codex", startedAt: new Date().toISOString(), logFile: "x", completedAt: new Date().toISOString() }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file cannot be parsed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a dead orphan's manifest as crashed and does not rehydrate it into active processes", () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    // A pid essentially guaranteed not to exist.
    const deadPid = 999_999;
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: deadPid,
        command: "x",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: "x",
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeTruthy();
  });

  it("rehydrates an alive orphan into the active-process set and emits process:started", () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "alive.json");
    const logPath = join(spoolDir, "alive.log");
    writeFileSync(logPath, "previously logged output");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive",
        pid: process.pid, // our own pid is guaranteed alive
        command: "claude",
        args: ["--flag"],
        runId: "run-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "alive",
      pid: process.pid,
      runId: "run-alive",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(runner.getProcessOutput("alive")).toBe("previously logged output");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive",
      "executor",
      "claude-code",
      "claude",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
  });

  it("rehydrates an alive orphan even when its log file does not exist yet", () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "no-log-yet.log");
    writeFileSync(
      join(spoolDir, "no-log-yet.json"),
      JSON.stringify({
        id: "no-log-yet",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-x",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
    // No pre-existing content, so the rolling buffer starts empty.
    expect(runner.getProcessOutput("no-log-yet")).toBe("");
  });

  it("finalizes a rehydrated orphan once its process is detected as dead by the periodic liveness poll", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "poll-dead.json");
    const logPath = join(spoolDir, "poll-dead.log");
    writeFileSync(logPath, "initial");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "poll-dead",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-poll",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    // First call is rehydrateOrphans' own initial liveness check (must succeed
    // so the orphan is rehydrated); subsequent calls come from the 5s poll
    // inside tailLogForOrphan, which we want to report the process as dead.
    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      killCalls += 1;
      if (pid === process.pid && killCalls > 1) {
        throw new Error("simulated: process is gone");
      }
      return true;
    });

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // The periodic liveness check runs every 5s; the mocked process.kill
    // above makes it look like the process just died.
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-poll",
      "poll-dead",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "poll-dead" }),
      "Orphaned process has exited",
    );

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeTruthy();
    expect(manifest.exitCode).toBe(-1);

    killSpy.mockRestore();
  });

  it("still finalizes and emits completion when the orphan's manifest file is missing at finalize time", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "poll-dead-no-manifest.json");
    const logPath = join(spoolDir, "poll-dead-no-manifest.log");
    writeFileSync(logPath, "initial");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "poll-dead-no-manifest",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-poll-2",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      killCalls += 1;
      if (pid === process.pid && killCalls > 1) {
        throw new Error("simulated: process is gone");
      }
      return true;
    });

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    unlinkSync(manifestPath); // manifest disappears before the orphan is finalized

    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-poll-2",
      "poll-dead-no-manifest",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    killSpy.mockRestore();
  });

  it("tails real growth of an orphan's log file into its rolling buffer", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "growing.json");
    const logPath = join(spoolDir, "growing.log");
    writeFileSync(logPath, "start\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "growing",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-grow",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    appendFileSync(logPath, "more output\n");

    await vi.waitFor(
      () => {
        const output = runner.getProcessOutput("growing");
        expect(output).toContain("more output");
      },
      { timeout: 4000, interval: 50 },
    );
  });
});
