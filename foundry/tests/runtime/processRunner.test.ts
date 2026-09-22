import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(actual.mkdirSync),
    createWriteStream: vi.fn(actual.createWriteStream),
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    existsSync: vi.fn(actual.existsSync),
    watch: vi.fn(actual.watch),
  };
});

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
import { ProcessRunner } from "../../src/runtime/processRunner.js";

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");

class FakeChildProcess extends EventEmitter {
  readonly stdin = { write: vi.fn(), end: vi.fn() };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  pid: number | undefined;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });

  constructor(pid: number | undefined = 4242) {
    super();
    this.pid = pid;
  }
}

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

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "some-cli",
    args: ["--flag"],
    cwd: "/tmp",
    timeoutMs: 10_000,
    ...overrides,
  };
}

let spoolDir: string;
let killSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));

  (spawn as unknown as Mock).mockReset();
  (spawn as unknown as Mock).mockImplementation(() => new FakeChildProcess());

  for (const fn of [mkdirSync, createWriteStream, readFileSync, readdirSync, writeFileSync, existsSync, watch]) {
    (fn as unknown as Mock).mockReset();
  }
  (mkdirSync as unknown as Mock).mockImplementation(actualFs.mkdirSync);
  (createWriteStream as unknown as Mock).mockImplementation(
    (...args: Parameters<typeof actualFs.createWriteStream>) => {
      const stream = actualFs.createWriteStream(...args);
      // The source never attaches an "error" listener to its log streams. In tests we
      // tear down the spool directory right after each test, which can race a still-open
      // write stream and raise an async ENOENT that would otherwise crash the run as an
      // unhandled exception. Swallow it here — it's irrelevant to what each test asserts.
      stream.on("error", () => {});
      return stream;
    },
  );
  (readFileSync as unknown as Mock).mockImplementation(actualFs.readFileSync);
  (readdirSync as unknown as Mock).mockImplementation(actualFs.readdirSync);
  (writeFileSync as unknown as Mock).mockImplementation(actualFs.writeFileSync);
  (existsSync as unknown as Mock).mockImplementation(actualFs.existsSync);
  (watch as unknown as Mock).mockImplementation(actualFs.watch);
});

afterEach(() => {
  killSpy?.mockRestore();
  killSpy = undefined;
  vi.useRealTimers();
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory recursively on construction", () => {
    const nested = join(spoolDir, "nested", "dir");
    new ProcessRunner("real", makeLogger() as never, undefined, nested);
    expect(mkdirSync).toHaveBeenCalledWith(nested, { recursive: true });
    expect(actualFs.existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner.execute — mock mode", () => {
  it("rejects when mock mode is enabled but no handler was configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and logs the call", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handlerResult = {
      stdout: "mock out",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const opts = baseOptions({ command: "claude", args: ["a"], cwd: "/repo" });
    const result = await runner.execute(opts);

    expect(handler).toHaveBeenCalledWith(opts);
    expect(result).toBe(handlerResult);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", args: ["a"], cwd: "/repo" }),
      "Executing mock process",
    );
    // spawn must never be invoked in mock mode
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute — real mode, happy paths", () => {
  it("spawns with merged env/cwd/stdio, concatenates chunked stdout/stderr, and resolves on exit 0", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({
        command: "echo",
        args: ["hi"],
        cwd: "/work",
        env: { FOO: "bar" },
      }),
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, spawnOpts] = (spawn as unknown as Mock).mock.calls[0]!;
    expect(cmd).toBe("echo");
    expect(args).toEqual(["hi"]);
    expect(spawnOpts.cwd).toBe("/work");
    expect(spawnOpts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(spawnOpts.env.FOO).toBe("bar");
    // process.env is merged in too
    expect(spawnOpts.env).toMatchObject(process.env);

    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn1 "));
    child.stderr.emit("data", Buffer.from("warn2"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn1 warn2",
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
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions({ stdinData: "hello stdin" }));
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    expect(child.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when stdinData is absent", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions());
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) on a non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions());
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when close is emitted with a null code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions());
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });
});

describe("ProcessRunner.execute — real mode, error handling", () => {
  it("rejects with the emitted error and never resolves", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions());
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("cleans up the tracked process and emits process:completed(-1) when a tracked process errors", async () => {
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "planner", runtime: "claude-code" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    // Process was registered before the error.
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      "some-cli",
    );
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    child.emit("error", new Error("ENOENT"));
    await expect(promise).rejects.toThrow("ENOENT");

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );

    const manifest = JSON.parse(
      actualFs.readFileSync(join(spoolDir, `${processId}.json`), "utf-8"),
    );
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
  });

  it("does not track a process when context is given but the child has no pid", async () => {
    // 0 is a falsy pid, same as the `child.pid` check in the source cares about;
    // avoid `undefined` here since that would trigger FakeChildProcess's default param.
    (spawn as unknown as Mock).mockImplementation(() => new FakeChildProcess(0));
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-2", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("skips cleanupProcess entirely when no context/processId was assigned and the child errors", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    child.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("boom");
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("swallows a manifest read failure during cleanup (best-effort update) without rejecting differently", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-3", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    (readFileSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("EIO: manifest unreadable");
    });

    const err = new Error("boom");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
    // Completion is still emitted with best-effort data even though the manifest file update failed.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-3",
      expect.any(String),
      "executor",
      "codex",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner.execute — real mode, timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("kills with SIGTERM on timeout and rejects with AgentTimeoutError using the runtime/stage label", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 1_000,
        context: { runId: "run-4", stage: "executor", runtime: "claude-code" },
      }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect((err as AgentTimeoutError).agent).toBe("claude-code/executor");
    expect((err as AgentTimeoutError).timeoutMs).toBe(1_000);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", timeoutMs: 1_000 }),
      "Process timed out",
    );
  });

  it("uses the bare command as the timeout label when no context is provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions({ command: "codex", timeoutMs: 500 }));
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", 0);

    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect((err as AgentTimeoutError).agent).toBe("codex");
  });

  it("escalates to SIGKILL after the grace period when the child never reports killed=true", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    // Simulate an unresponsive process: kill() "succeeds" but never actually terminates it.
    child.kill = vi.fn().mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when the child is already killed after SIGTERM", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    // Default fake kill() sets `killed = true` immediately, like a responsive process.

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });
});

describe("ProcessRunner — active process tracking, buffering, and getProcessOutput", () => {
  it("tracks an active process and reports elapsedMs/startedAt via getActiveProcesses()", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-5", stage: "planner", runtime: "claude-code" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "some-cli",
      runId: "run-5",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(new Date(active[0]!.startedAt).toString()).not.toBe("Invalid Date");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    child.emit("close", 0);
    await promise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("returns the live rolling buffer for an active process via getProcessOutput()", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-6", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    child.stdout.emit("data", Buffer.from("partial output so far"));
    expect(runner.getProcessOutput(processId)).toBe("partial output so far");

    child.emit("close", 0);
    await promise;
  });

  it("truncates the in-memory rolling buffer to the last 8KB", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-7", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    // 8000 + 300 = 8300 chars total, which exceeds ROLLING_BUFFER_MAX (8192) by 108 —
    // the buffer should drop exactly the oldest 108 "A"s and keep everything else.
    const chunkA = "A".repeat(8_000);
    const chunkB = "B".repeat(300);
    child.stdout.emit("data", Buffer.from(chunkA));
    child.stdout.emit("data", Buffer.from(chunkB));

    const buffered = runner.getProcessOutput(processId)!;
    expect(buffered.length).toBe(8 * 1024);
    expect(buffered.endsWith(chunkB)).toBe(true);
    expect(buffered.startsWith("A".repeat(8_000 - 108))).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions and truncates each emitted chunk to 500 chars", async () => {
    vi.useFakeTimers();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-8", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;

    const longChunk = "x".repeat(600) + "[END]";
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , firstEmitted] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(firstEmitted).toBe(longChunk.slice(-500));

    // Fired again immediately, well within the 250ms throttle window -> suppressed.
    child.stdout.emit("data", Buffer.from("y"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window, then a further chunk should emit again.
    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("z"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
  });

  it("does not emit process:output at all when no emitter was configured", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const promise = runner.execute(
      baseOptions({ context: { runId: "run-9", stage: "executor", runtime: "codex" } }),
    );
    const child = (spawn as unknown as Mock).mock.results[0]!.value as FakeChildProcess;
    // No emitter -> should not throw even though data/close events fire.
    child.stdout.emit("data", Buffer.from("hello"));
    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ stdout: "hello" });
  });

  it("getProcessOutput returns null for an unknown processId with no log file on disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("getProcessOutput reads and tails a completed process's log file from disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const logContent = "line one\nline two\n";
    actualFs.writeFileSync(join(spoolDir, "finished-proc.log"), logContent);

    expect(runner.getProcessOutput("finished-proc")).toBe(logContent.slice(-8 * 1024));
  });

  it("getProcessOutput returns null when the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    actualFs.writeFileSync(join(spoolDir, "broken-proc.log"), "content");

    (readFileSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(runner.getProcessOutput("broken-proc")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns without throwing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    (readdirSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT: spool dir gone");
    });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files and manifests that are already completed", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    actualFs.writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
    actualFs.writeFileSync(
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 99999,
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: "x.log",
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file fails to parse", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    actualFs.writeFileSync(join(spoolDir, "corrupt-proc.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt-proc.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a dead orphan's manifest as crashed with exitCode -1", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead-proc.json");
    actualFs.writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: 424242,
        command: "x",
        args: [],
        runId: "r1",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 424242 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(actualFs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates an alive orphan, seeds its rolling buffer from the existing log, tails new writes via the watcher, and finalizes it once the process disappears", async () => {
    vi.useFakeTimers();
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const processId = "alive-proc";
    const logPath = join(spoolDir, `${processId}.log`);
    const manifestPath = join(spoolDir, `${processId}.json`);
    const initialLog = "old-line\n";
    actualFs.writeFileSync(logPath, initialLog);
    actualFs.writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 555,
        command: "claude",
        args: [],
        runId: "run-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let alive = true;
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });

    const fakeWatcher = { close: vi.fn() };
    (watch as unknown as Mock).mockImplementationOnce(() => fakeWatcher as never);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId, pid: 555, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      processId,
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses().map((p) => p.id)).toContain(processId);
    expect(runner.getProcessOutput(processId)).toBe(initialLog);

    expect(watch).toHaveBeenCalledTimes(1);
    const watchCallback = (watch as unknown as Mock).mock.calls[0]![1] as () => void;

    // Simulate a new write to the log file, then trigger the watcher callback manually.
    actualFs.writeFileSync(logPath, initialLog + "new-line\n");
    watchCallback();
    expect(runner.getProcessOutput(processId)).toBe(initialLog + "new-line\n");

    // A read failure inside the watcher callback (e.g. a transient I/O error) is
    // swallowed -- the rolling buffer is left exactly as it was.
    actualFs.writeFileSync(logPath, initialLog + "new-line\nyet-more\n");
    (readFileSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("EIO: transient read error");
    });
    expect(() => watchCallback()).not.toThrow();
    expect(runner.getProcessOutput(processId)).toBe(initialLog + "new-line\n");

    // Poll interval fires every 5s; process still alive -> nothing changes.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Now the process disappears; the next poll should finalize it. Make the manifest
    // read inside finalizeOrphan fail too, to exercise its best-effort catch branch.
    alive = false;
    (readFileSync as unknown as Mock).mockImplementationOnce(() => {
      throw new Error("EIO: manifest unreadable during finalize");
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-alive",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId, pid: 555 }),
      "Orphaned process has exited",
    );
    // The manifest read inside finalizeOrphan was made to fail above, so the on-disk
    // manifest is left exactly as originally written (best-effort update, not required
    // for finalization to still complete and notify listeners).
    const finalManifest = JSON.parse(actualFs.readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBeUndefined();
    expect(finalManifest.completedAt).toBeUndefined();

    // Calling the watcher callback again after finalization hits the "entry gone" branch
    // and closes the watcher (idempotently) instead of touching a removed entry.
    watchCallback();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(2);
  });

  it("swallows a missing/unreadable log file when seeding the rolling buffer for an alive orphan", () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const processId = "alive-no-log";
    const manifestPath = join(spoolDir, `${processId}.json`);
    actualFs.writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 777,
        command: "codex",
        args: [],
        runId: "run-x",
        stage: "reviewer",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, `${processId}.log`),
      }),
    );

    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    (watch as unknown as Mock).mockImplementationOnce(() => ({ close: vi.fn() }) as never);

    // No log file was ever written for this process -- readFileSync(logPath) throws ENOENT,
    // which should be swallowed and leave the rolling buffer empty rather than throwing.
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getProcessOutput(processId)).toBe("");
  });
});
