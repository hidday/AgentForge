import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// `watch` defaults to delegating to the real implementation (so the
// "happy path" orphan-rehydration tests still exercise real OS file
// watching), but individual tests can override it with
// `watchMock.mockImplementationOnce(...)` to drive the watcher's callback
// deterministically instead of depending on real, timing-sensitive
// filesystem-change notifications.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(actual.watch) };
});

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
const watchMock = watch as unknown as ReturnType<typeof vi.fn>;

class FakeChildProcess extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    // Mirrors real Node semantics: `.killed` flips to true once a signal is
    // successfully dispatched, regardless of whether the process has
    // actually exited yet.
    this.killed = true;
    return true;
  });
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function spawnFakeChild(): FakeChildProcess {
  const child = new FakeChildProcess();
  spawnMock.mockReturnValueOnce(child);
  return child;
}

let spoolDir: string;

beforeEach(() => {
  spawnMock.mockReset();
  watchMock.mockClear();
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
});

afterEach(() => {
  vi.useRealTimers();
  // Deliberately not rmSync-ing spoolDir here: ProcessRunner's internal
  // log WriteStreams open their fd asynchronously, so an immediate rmSync
  // can race a still-pending open() and surface as an unhandled ENOENT
  // after the test has already finished. These are tiny per-test temp
  // dirs under the OS tmpdir, which the OS reclaims on its own.
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory recursively, even when nested and missing", () => {
    const nested = join(spoolDir, "a", "b", "c");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("real", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("throws when execute() is called without a mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and logs a debug line", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const fixedResult = {
      stdout: "mock out",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(fixedResult);
    runner.setMockHandler(handler);

    const result = await runner.execute({
      command: "fake",
      args: ["--flag"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });

    expect(result).toEqual(fixedResult);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake", args: ["--flag"] }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake", args: ["--flag"] }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner real mode: successful and non-zero-exit completion", () => {
  it("resolves with collected stdout/stderr and exitCode 0 on a clean exit", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: nothing serious"));
    child.emit("close", 0);

    const result = await resultPromise;

    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn: nothing serious");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves (does not reject) with a non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "false",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 1);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("falls back to exit code 1 when the close event reports a null code", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "weird",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.emit("close", null);
    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child's stdin and ends it when stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "hello from caller",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("hello from caller");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await resultPromise;
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await resultPromise;
  });

  it("merges extra env vars on top of process.env when spawning", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "env",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { FOO: "bar" },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "env",
      [],
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({ FOO: "bar" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    child.emit("close", 0);
    await resultPromise;
  });
});

describe("ProcessRunner real mode: spawn error", () => {
  it("rejects with the underlying error when the child process emits an error (e.g. ENOENT)", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    const enoent = Object.assign(new Error("spawn does-not-exist ENOENT"), { code: "ENOENT" });
    child.emit("error", enoent);

    await expect(resultPromise).rejects.toBe(enoent);
  });

  it("marks a tracked process as crashed (exitCode -1) in its manifest when spawn errors", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    const err = new Error("spawn ENOENT");
    child.emit("error", err);
    await expect(resultPromise).rejects.toBe(err);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    const processId = emitter.emitProcessCompleted.mock.calls[0]![1] as string;
    const manifestPath = join(spoolDir, `${processId}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
  });
});

describe("ProcessRunner real mode: timeout handling", () => {
  it("kills the process with SIGTERM after timeoutMs and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "slow-agent",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
      context: { runId: "run-2", stage: "executor", runtime: "codex" },
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Because our fake child marks itself `.killed = true` right after the
    // first kill() call (matching real Node semantics), the secondary
    // SIGKILL guard should NOT fire even once the 5s grace period elapses.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "slow-agent", timeoutMs: 10_000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL after the grace period when the process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();
    // Simulate a stubborn process: kill() does not flip `.killed`.
    child.kill = vi.fn().mockReturnValue(true);

    const resultPromise = runner.execute({
      command: "stubborn-agent",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not time out or kill the process when it closes before timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "quick-agent",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner real mode: active-process tracking and manifests", () => {
  it("tracks an active process, writes its manifest, emits started/completed, and cleans up on close", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-3",
      stage: "planner",
      runtime: "claude-code",
    });
    const processId = active[0]!.id;

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-3",
      processId,
      "planner",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${processId}.json`);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore.completedAt).toBeUndefined();
    expect(manifestBefore.pid).toBe(4242);
    expect(manifestBefore.args).toEqual(["--print"]);

    child.stdout.emit("data", Buffer.from("partial output"));
    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.stdout).toBe("partial output");

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-3",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.completedAt).toBeDefined();
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.durationMs).toBe("number");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId, exitCode: 0, runId: "run-3" }),
      "Agent process completed",
    );
  });

  it("does not create an active entry or manifest when no context is provided", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await resultPromise;

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not track or clean up a process when context is provided but the child has no pid", async () => {
    // context is truthy and a processId is generated, but the
    // `context && processId && child.pid` guard fails because pid is
    // falsy, so no active entry/manifest is ever created. The close
    // handler still calls cleanupProcess(processId, ...) because
    // processId itself is truthy -- exercising cleanupProcess's own
    // "no matching entry" guard.
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = spawnFakeChild();
    // @ts-expect-error -- simulate a child that failed to acquire a pid
    child.pid = undefined;

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-no-pid", stage: "executor", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Agent process completed",
    );
  });

  it("completes cleanup via the public API even when the process's manifest file is missing at close time", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-no-manifest", stage: "executor", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    rmSync(join(spoolDir, `${processId}.json`));

    child.emit("close", 0);
    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    // cleanupProcess's manifest read/write is best-effort: it swallows the
    // failed read and still runs the rest of cleanup (removal from the
    // active map, emitter notification, and logging).
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-no-manifest",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId }),
      "Agent process completed",
    );
  });

  it("computes elapsedMs for an active process based on current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 999_999,
      context: { runId: "run-4", stage: "planner", runtime: "claude-code" },
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    const active = runner.getActiveProcesses();
    expect(active[0]!.elapsedMs).toBe(5000);

    child.emit("close", 0);
    await resultPromise;
  });
});

describe("ProcessRunner: appendToBuffer truncation and output throttling", () => {
  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX (8KB) characters", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "chatty",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-5", stage: "executor", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    const bigChunk = "a".repeat(9000);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const buffered = runner.getProcessOutput(processId);
    expect(buffered).toHaveLength(8 * 1024);
    expect(buffered).toBe(bigChunk.slice(-8 * 1024));

    child.emit("close", 0);
    await resultPromise;
  });

  it("throttles process:output emissions to roughly once per 250ms and slices long chunks to 500 chars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "chatty",
      args: [],
      cwd: "/tmp",
      timeoutMs: 999_999,
      context: { runId: "run-6", stage: "executor", runtime: "claude-code" },
    });

    // First chunk always emits immediately (lastEmitMs starts at 0).
    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // A second chunk within the 250ms throttle window should NOT emit again.
    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window; the next chunk should emit.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.300Z"));
    const longChunk = "y".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(emittedChunk).toHaveLength(500);
    expect(emittedChunk).toBe(longChunk.slice(-500));

    child.emit("close", 0);
    await resultPromise;
  });

  it("does not attempt to emit process output when no emitter is configured", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = spawnFakeChild();

    const resultPromise = runner.execute({
      command: "quiet",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-7", stage: "executor", runtime: "claude-code" },
    });

    expect(() => child.stdout.emit("data", Buffer.from("hello"))).not.toThrow();

    child.emit("close", 0);
    await resultPromise;
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns null when the process is neither active nor has a log file on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("returns the trailing ROLLING_BUFFER_MAX characters from a completed process's log file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const content = "z".repeat(9000);
    writeFileSync(join(spoolDir, "proc-123.log"), content);

    const output = runner.getProcessOutput("proc-123");
    expect(output).toHaveLength(8 * 1024);
    expect(output).toBe(content.slice(-8 * 1024));
  });

  it("returns null when reading an existing log file throws", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const logPath = join(spoolDir, "proc-456.log");
    writeFileSync(logPath, "will become a directory's victim");
    // Replace the file with a directory of the same name so existsSync()
    // reports true but readFileSync() throws (EISDIR).
    rmSync(logPath);
    mkdirSync(logPath);

    expect(runner.getProcessOutput("proc-456")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently without throwing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-manifest files in the spool directory", () => {
    writeFileSync(join(spoolDir, "notes.txt"), "not a manifest");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and marks the manifest crashed when the orphaned pid is no longer alive", () => {
    const manifestPath = join(spoolDir, "dead-proc.json");
    const manifest = {
      id: "dead-proc",
      pid: 2_147_483_647, // guaranteed not a live pid
      command: "claude",
      args: [],
      runId: "run-dead",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "dead-proc.log"),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: manifest.pid }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
  });

  it("skips manifests that are already marked completed", () => {
    const manifestPath = join(spoolDir, "done-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "done-proc",
        pid: 1,
        command: "claude",
        args: [],
        runId: "run-done",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    writeFileSync(join(spoolDir, "corrupt.json"), "{ not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphan into an active process, picks up existing log content, and finalizes it once the process disappears", async () => {
    vi.useFakeTimers();

    const logPath = join(spoolDir, "alive-proc.log");
    writeFileSync(logPath, "previously captured output");

    const manifestPath = join(spoolDir, "alive-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive-proc",
        pid: process.pid,
        command: "claude",
        args: ["--print"],
        runId: "run-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    let killCallCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((..._args: unknown[]) => {
      killCallCount += 1;
      if (killCallCount > 1) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);

    try {
      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-proc", pid: process.pid }),
        "Rehydrating orphaned agent process",
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive-proc",
        "executor",
        "claude-code",
        "claude",
      );

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive-proc", pid: process.pid });
      expect(runner.getProcessOutput("alive-proc")).toBe("previously captured output");

      // The poll interval fires every 5s; the second process.kill() call
      // (mocked to throw) simulates the orphan disappearing.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "alive-proc",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-proc", pid: process.pid }),
        "Orphaned process has exited",
      );

      const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestAfter.exitCode).toBe(-1);
      expect(manifestAfter.completedAt).toBeDefined();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("falls back to an empty rolling buffer when the orphan's log file cannot be read yet, and records the resulting tailLogForOrphan failure", () => {
    // No .log file is created up front, so the `readFileSync(logPath)`
    // inside rehydrateOrphans's "alive" branch throws and is swallowed
    // (rollingBuffer stays ""). The process is still registered as
    // active *before* tailLogForOrphan runs -- and because the log file
    // genuinely does not exist yet, the real `fs.watch()` call inside
    // tailLogForOrphan throws synchronously (Node's fs.watch requires the
    // watched path to already exist), which is caught by rehydrateOrphans's
    // outer per-manifest try/catch and reported as a failed manifest.
    const manifestPath = join(spoolDir, "no-log-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "no-log-proc",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-no-log",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "no-log-proc.log"),
      }),
    );

    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "no-log-proc" }),
      "Rehydrating orphaned agent process",
    );
    // The entry was added to the active map before tailLogForOrphan's
    // fs.watch() call threw, so it is left behind with an empty buffer.
    expect(runner.getProcessOutput("no-log-proc")).toBe("");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "no-log-proc.json" }),
      "Failed to process manifest",
    );
  });
});

describe("ProcessRunner: constructor default spool directory", () => {
  it("defaults to .foundry/processes under the current working directory when no spoolDir is given", () => {
    const defaultDir = join(process.cwd(), ".foundry", "processes");
    const preexisting = existsSync(defaultDir);
    new ProcessRunner("real", makeMockLogger() as never, undefined);
    try {
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      if (!preexisting) {
        rmSync(join(process.cwd(), ".foundry"), { recursive: true, force: true });
      }
    }
  });
});

describe("ProcessRunner: tailLogForOrphan's fs.watch callback (driven directly via a mocked watch())", () => {
  function setupAliveOrphan(logger: ReturnType<typeof makeMockLogger>) {
    const logPath = join(spoolDir, "watched.log");
    writeFileSync(logPath, "initial");

    const manifestPath = join(spoolDir, "watched.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "watched",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-watched",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    return { runner, logPath };
  }

  it("appends newly written log content to the rolling buffer when the watch callback fires", () => {
    const fakeWatcher = { close: vi.fn() };
    let capturedListener: (() => void) | undefined;
    watchMock.mockImplementationOnce((_path: unknown, listener: () => void) => {
      capturedListener = listener;
      return fakeWatcher as never;
    });

    const { runner, logPath } = setupAliveOrphan(makeMockLogger());
    runner.rehydrateOrphans();
    expect(capturedListener).toBeDefined();

    writeFileSync(logPath, "initial + more output");
    capturedListener!();

    expect(runner.getProcessOutput("watched")).toBe("initial + more output");
  });

  it("does not re-append when the watch callback fires but the file content has not grown", () => {
    const fakeWatcher = { close: vi.fn() };
    let capturedListener: (() => void) | undefined;
    watchMock.mockImplementationOnce((_path: unknown, listener: () => void) => {
      capturedListener = listener;
      return fakeWatcher as never;
    });

    const { runner } = setupAliveOrphan(makeMockLogger());
    runner.rehydrateOrphans();

    // Fire the listener with no underlying file change.
    capturedListener!();
    expect(runner.getProcessOutput("watched")).toBe("initial");
  });

  it("closes the watcher and no-ops when the watch callback fires after the entry has already been removed", () => {
    const fakeWatcher = { close: vi.fn() };
    let capturedListener: (() => void) | undefined;
    watchMock.mockImplementationOnce((_path: unknown, listener: () => void) => {
      capturedListener = listener;
      return fakeWatcher as never;
    });

    const { runner } = setupAliveOrphan(makeMockLogger());
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Simulate the process having already been finalized/removed by some
    // other path before this (now-stale) watch event is delivered.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "watched",
    );

    expect(() => capturedListener!()).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  it("silently ignores a read failure inside the watch callback", async () => {
    const fakeWatcher = { close: vi.fn() };
    let capturedListener: (() => void) | undefined;
    watchMock.mockImplementationOnce((_path: unknown, listener: () => void) => {
      capturedListener = listener;
      return fakeWatcher as never;
    });

    const { runner } = setupAliveOrphan(makeMockLogger());
    runner.rehydrateOrphans();

    // Inject a single readFileSync failure for the watch callback's own
    // read, without disturbing the real log file (which the entry's
    // WriteStream still holds an async-pending open() against -- replacing
    // it on disk here would otherwise race that open and surface as an
    // unhandled stream error later).
    const fs = await import("node:fs");
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementationOnce(() => {
        throw new Error("simulated read failure");
      });

    try {
      expect(() => capturedListener!()).not.toThrow();
    } finally {
      readSpy.mockRestore();
    }
    // The rolling buffer is left exactly as it was before the failed read.
    expect(runner.getProcessOutput("watched")).toBe("initial");
  });
});

describe("ProcessRunner: orphan poll-interval edge cases", () => {
  it("clears the interval and no-ops in finalizeOrphan when the entry was already removed before the death check fires", async () => {
    vi.useFakeTimers();

    const logPath = join(spoolDir, "vanished.log");
    writeFileSync(logPath, "output");
    const manifestPath = join(spoolDir, "vanished.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "vanished",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-vanished",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    let killCallCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((..._args: unknown[]) => {
      killCallCount += 1;
      if (killCallCount > 1) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the entry out-of-band (e.g. as if some other code path had
      // already finalized it) right before the poll interval's next tick,
      // so `activeProcesses.get(processId)?.pid` falls back to `?? 0` and
      // finalizeOrphan's own `if (!entry) return;` guard fires.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "vanished",
      );

      await vi.advanceTimersByTimeAsync(5_000);

      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ processId: "vanished" }),
        "Orphaned process has exited",
      );
    } finally {
      killSpy.mockRestore();
    }
  });

  it("still finalizes an orphan (removal, emitter notification, logging) even when its manifest file is missing when the death check fires", async () => {
    vi.useFakeTimers();

    const logPath = join(spoolDir, "no-manifest-at-death.log");
    writeFileSync(logPath, "output");
    const manifestPath = join(spoolDir, "no-manifest-at-death.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "no-manifest-at-death",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-no-manifest-at-death",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    let killCallCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((..._args: unknown[]) => {
      killCallCount += 1;
      if (killCallCount > 1) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // The manifest disappears before the orphan is detected as dead.
      rmSync(manifestPath);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-no-manifest-at-death",
        "no-manifest-at-death",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "no-manifest-at-death" }),
        "Orphaned process has exited",
      );
    } finally {
      killSpy.mockRestore();
    }
  });
});
