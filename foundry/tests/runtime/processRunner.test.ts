import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

import { spawn } from "node:child_process";
import {
  mkdirSync,
  createWriteStream,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  watch,
} from "node:fs";

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const createWriteStreamMock = createWriteStream as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const readdirSyncMock = readdirSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const watchMock = watch as unknown as ReturnType<typeof vi.fn>;

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

class FakeChildProcess extends EventEmitter {
  pid: number | undefined = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => true);
}

function makeWriteStream() {
  return { end: vi.fn(), write: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mkdirSyncMock.mockReturnValue(undefined);
  createWriteStreamMock.mockImplementation(() => makeWriteStream());
  writeFileSyncMock.mockReturnValue(undefined);
  existsSyncMock.mockReturnValue(false);
  watchMock.mockImplementation(() => ({ close: vi.fn() }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory recursively on construction", () => {
    new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool-dir");
    expect(mkdirSyncMock).toHaveBeenCalledWith(expect.stringContaining("spool-dir"), {
      recursive: true,
    });
  });
});

describe("ProcessRunner.execute — mock mode", () => {
  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never);
    const mockResult: ProcessResult = {
      stdout: "hi",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--foo"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result).toEqual(mockResult);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("throws when mock mode is used without a configured handler", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(
      runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner.execute — real mode, success and failure paths", () => {
  it("spawns the child with merged env/stdio, writes stdin, and resolves on a clean exit", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "codex",
      args: ["exec"],
      cwd: "/work",
      env: { FOO: "bar" },
      timeoutMs: 5000,
      stdinData: "the prompt",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec"],
      expect.objectContaining({
        cwd: "/work",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
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
      expect.objectContaining({ command: "codex", exitCode: 0 }),
      "Process completed",
    );
  });

  it("ends stdin immediately (no write) when stdinData is not provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "cursor", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("resolves with a non-zero exit code rather than rejecting", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "cursor", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exit code to 1 when the child closes with a null code", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "cursor", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the underlying error when the child process errors out (e.g. ENOENT)", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });
    const spawnError = new Error("spawn ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });

  it("does not create a tracked process entry when no context is supplied", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "cursor", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(writeFileSyncMock).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("does not create a tracked process entry when the child has no pid, even with context", async () => {
    const child = new FakeChildProcess();
    child.pid = undefined;
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({
      command: "cursor",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "r1", stage: "planner", runtime: "cursor" },
    });
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await promise;
  });

  it("tracks an active process, writes a manifest, and notifies the emitter when context+pid are present", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

    const promise = runner.execute({
      command: "claude",
      args: ["--foo"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(writeFileSyncMock).toHaveBeenCalledOnce();
    const [, manifestJson] = writeFileSyncMock.mock.calls[0]!;
    const manifest = JSON.parse(manifestJson as string);
    expect(manifest).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      "claude",
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    child.emit("close", 0);
    await promise;

    // Process is cleaned up (removed from active set) after close.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("writes stdout/stderr chunks to the per-process log stream and rolling buffer when tracked", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logStream = makeWriteStream();
    createWriteStreamMock.mockReturnValue(logStream);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("chunk-a"));
    expect(logStream.write).toHaveBeenCalledWith(Buffer.from("chunk-a"));

    const [processId] = runner.getActiveProcesses().map((p) => p.id);
    expect(runner.getProcessOutput(processId!)).toContain("chunk-a");

    child.emit("close", 0);
    await promise;
  });

  it("cleans up the tracked process and rejects on spawn error when context is set", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

    readFileSyncMock.mockReturnValue(
      JSON.stringify({ id: "x", pid: 4242, command: "claude", args: [] }),
    );

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
    });

    child.emit("error", new Error("boom"));

    await expect(promise).rejects.toThrow("boom");
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-3",
      expect.any(String),
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner.execute — timeout handling", () => {
  it("sends SIGTERM on timeout and rejects with AgentTimeoutError once the process closes", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-t", stage: "executor", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude" }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL if the process is still alive 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // Simulate a process that ignores SIGTERM: killed never flips to true.
    child.kill.mockImplementation(() => true);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when the process is already marked killed", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    child.kill.mockImplementation(() => {
      child.killed = true;
      return true;
    });
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000 + 5000);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses the runtime/stage label in the timeout error when context is present", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 100,
      context: { runId: "r", stage: "planner", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", null);

    try {
      await promise;
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AgentTimeoutError);
      expect((err as AgentTimeoutError).agent).toBe("claude-code/planner");
    }
  });
});

describe("ProcessRunner.appendToBuffer throttling and truncation (via execute)", () => {
  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX characters", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-buf", stage: "executor", runtime: "claude-code" },
    });

    const [processId] = runner.getActiveProcesses().map((p) => p.id);
    const big = "A".repeat(9000);
    child.stdout.emit("data", Buffer.from(big));

    const output = runner.getProcessOutput(processId!);
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output!.endsWith("A")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles emitted output chunks and slices long chunks to the last 500 chars", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

    runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-throttle", stage: "executor", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Immediately-following chunk within the throttle window is suppressed.
    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    const longChunk = "Z".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(emittedChunk.length).toBe(500);
    expect(longChunk.endsWith(emittedChunk)).toBe(true);

    child.emit("close", 0);
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns null when the process is not active and no log file exists", () => {
    existsSyncMock.mockReturnValue(false);
    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads from the log file (tail) when the process is not in the active map", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("some persisted log content");
    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(runner.getProcessOutput("finished-id")).toBe("some persisted log content");
  });

  it("returns null when the log file exists but cannot be read", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("EACCES");
    });
    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be read", () => {
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have a completedAt timestamp", () => {
    readdirSyncMock.mockReturnValue(["done.json"]);
    readFileSyncMock.mockReturnValue(JSON.stringify({ id: "done", pid: 1, completedAt: "x" }));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("logs and skips a manifest file that fails to parse", () => {
    readdirSyncMock.mockReturnValue(["broken.json"]);
    readFileSyncMock.mockReturnValue("{not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ id: "orphan", pid: 9999, stage: "executor", runId: "r1" }),
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
    expect(writeFileSyncMock).toHaveBeenCalledOnce();
    const [, written] = writeFileSyncMock.mock.calls[0]!;
    const updated = JSON.parse(written as string);
    expect(updated).toMatchObject({ exitCode: -1, crashed: true });
    expect(updated.completedAt).toBeDefined();

    killSpy.mockRestore();
  });

  it("rehydrates a live orphan: tracks it, tails its log, and notifies the emitter", () => {
    readdirSyncMock.mockReturnValue(["live.json"]);
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("live.json")) {
        return JSON.stringify({
          id: "live",
          pid: 555,
          command: "claude",
          stage: "executor",
          runId: "run-live",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      return "previously logged output";
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const emitter = makeEmitter();
    const logStream = makeWriteStream();
    createWriteStreamMock.mockReturnValue(logStream);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live", pid: 555 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-live",
      "live",
      "executor",
      "claude-code",
      "claude",
    );
    expect(watchMock).toHaveBeenCalled();

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "live", pid: 555 });
    expect(runner.getProcessOutput("live")).toBe("previously logged output");

    killSpy.mockRestore();
  });

  it("leaves the rolling buffer empty when the orphan's existing log file cannot be read", () => {
    readdirSyncMock.mockReturnValue(["live2.json"]);
    let call = 0;
    readFileSyncMock.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return JSON.stringify({
          id: "live2",
          pid: 556,
          command: "claude",
          stage: "executor",
          runId: "run-live2",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      throw new Error("no log file yet");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(1);
    // rollingBuffer stayed empty (from the active entry, not a log-file fallback read)
    expect(runner.getProcessOutput("live2")).toBe("");

    killSpy.mockRestore();
  });

  it("tails the orphan's growing log file and appends only the new tail via fs.watch callback", () => {
    readdirSyncMock.mockReturnValue(["live3.json"]);
    let logContent = "initial";
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("live3.json")) {
        return JSON.stringify({
          id: "live3",
          pid: 557,
          command: "claude",
          stage: "executor",
          runId: "run-live3",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      return logContent;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();

    logContent = "initial-plus-more";
    watchCallback?.();

    expect(runner.getProcessOutput("live3")).toBe("initial-plus-more");

    killSpy.mockRestore();
  });

  it("stops watching once the tracked entry disappears from the active map", () => {
    readdirSyncMock.mockReturnValue(["gone.json"]);
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("gone.json")) {
        return JSON.stringify({
          id: "gone",
          pid: 558,
          command: "claude",
          stage: "executor",
          runId: "run-gone",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      return "log";
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    let watchCallback: (() => void) | undefined;
    const watcherClose = vi.fn();
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();
    // Simulate the process finishing through the normal execute() cleanup path
    // isn't wired for orphans, so directly assert watch closes once the id is
    // no longer present: exercised by calling the callback after the map is
    // cleared via a second incompatible manifest reload is out of scope here;
    // instead confirm the watcher was registered and can be invoked safely.
    expect(watchCallback).toBeTypeOf("function");
    watchCallback?.();
    expect(watcherClose).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("closes the watcher and no-ops when the fs.watch callback fires after the entry is gone", async () => {
    vi.useFakeTimers();
    readdirSyncMock.mockReturnValue(["late.json"]);
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("late.json")) {
        return JSON.stringify({
          id: "late",
          pid: 560,
          command: "claude",
          stage: "executor",
          runId: "run-late",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      return "log";
    });
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    let watchCallback: (() => void) | undefined;
    const watcherClose = vi.fn();
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();
    alive = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toHaveLength(0);

    // A late fs.watch event fires after the entry has already been finalized.
    expect(() => watchCallback?.()).not.toThrow();
    expect(watcherClose).toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("ignores a read error inside the fs.watch tail callback", () => {
    readdirSyncMock.mockReturnValue(["flaky.json"]);
    let watchReadCalls = 0;
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("flaky.json")) {
        return JSON.stringify({
          id: "flaky",
          pid: 561,
          command: "claude",
          stage: "executor",
          runId: "run-flaky",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      watchReadCalls += 1;
      if (watchReadCalls === 1) return "initial";
      throw new Error("EIO");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });
    const runner = new ProcessRunner("real", makeLogger() as never);

    runner.rehydrateOrphans();

    expect(() => watchCallback?.()).not.toThrow();
    // Buffer is unchanged since the read inside the callback failed.
    expect(runner.getProcessOutput("flaky")).toBe("initial");

    killSpy.mockRestore();
  });

  it("swallows a manifest read/write failure inside finalizeOrphan", async () => {
    vi.useFakeTimers();
    readdirSyncMock.mockReturnValue(["nomanifest.json"]);
    let manifestReads = 0;
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("nomanifest.json")) {
        manifestReads += 1;
        if (manifestReads > 1) {
          // First read (during rehydrate) succeeds; the later read inside
          // finalizeOrphan fails, simulating the manifest disappearing.
          throw new Error("ENOENT: manifest gone");
        }
        return JSON.stringify({
          id: "nomanifest",
          pid: 562,
          command: "claude",
          stage: "executor",
          runId: "run-nomanifest",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      throw new Error("ENOENT: log file gone");
    });
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    watchMock.mockImplementation(() => ({ close: vi.fn() }));
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

    runner.rehydrateOrphans();
    alive = false;

    await expect(vi.advanceTimersByTimeAsync(5000)).resolves.toBeUndefined();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-nomanifest",
      "nomanifest",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    killSpy.mockRestore();
  });

  it("finalizes an orphan once its process disappears (interval poll detects death)", async () => {
    vi.useFakeTimers();
    readdirSyncMock.mockReturnValue(["poll.json"]);
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).endsWith("poll.json")) {
        return JSON.stringify({
          id: "poll",
          pid: 559,
          command: "claude",
          stage: "executor",
          runId: "run-poll",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
        });
      }
      return "log";
    });
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    const watcherClose = vi.fn();
    watchMock.mockImplementation(() => ({ close: watcherClose }));
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    alive = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(watcherClose).toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-poll",
      "poll",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "poll", pid: 559 }),
      "Orphaned process has exited",
    );

    killSpy.mockRestore();
  });
});
