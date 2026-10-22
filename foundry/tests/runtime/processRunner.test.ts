import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
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
import { AgentTimeoutError } from "../../src/utils/errors.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

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

function makeFakeChild(pid: number | undefined = 1234) {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number;
    killed: boolean;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.killed = false;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((_sig: string) => {
    child.killed = true;
    return true;
  });
  return child;
}

const mockedCreateWriteStream = vi.mocked(createWriteStream);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedWatch = vi.mocked(watch);
const mockedSpawn = vi.mocked(spawn);
const mockedMkdirSync = vi.mocked(mkdirSync);

function fakeWriteStream() {
  return { write: vi.fn(), end: vi.fn() } as unknown as ReturnType<typeof createWriteStream>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateWriteStream.mockReturnValue(fakeWriteStream());
  mockedWriteFileSync.mockImplementation(() => undefined);
  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockImplementation(() => {
    throw new Error("ENOENT");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner construction", () => {
  it("ensures the spool directory exists on construction", () => {
    new ProcessRunner("mock", makeLogger() as never, undefined, "/tmp/my-spool");
    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("my-spool"),
      { recursive: true },
    );
  });
});

describe("ProcessRunner mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/tmp/spool");
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/tmp/spool");
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({ command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"] }),
    );
    expect(result.stdout).toBe("mocked");
  });
});

describe("ProcessRunner real mode: execute()", () => {
  it("resolves with concatenated stdout/stderr and exit code on a clean close", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 10_000 });

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
  });

  it("writes stdinData to the child and ends stdin when provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
      stdinData: "input data",
    });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("input data");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("ends stdin immediately when no stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "cat", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the spawn error on an 'error' event", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "nope", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });

  it("kills the child with SIGTERM and rejects with AgentTimeoutError when the timeout elapses", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 50 });

    vi.advanceTimersByTime(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);

    vi.clearAllTimers();
  });

  it("escalates to SIGKILL if the child has not exited 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(undefined);
    child.kill = vi.fn(); // does not flip `killed` — simulates an unresponsive process
    mockedSpawn.mockReturnValue(child as never);

    void runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 50 });

    vi.advanceTimersByTime(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    vi.clearAllTimers();
  });
});

describe("ProcessRunner real mode: context tracking", () => {
  it("tracks an active process, emits lifecycle events, and cleans up on completion", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = makeFakeChild(4321);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 10_000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4321,
      command: "echo",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    const processId = active[0]!.id;
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "executor",
      "claude-code",
      "echo",
    );
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(processId),
      expect.any(String),
    );

    child.stdout.emit("data", Buffer.from("hi"));
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("does not track a process (no manifest/events) when no context is given", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = makeFakeChild(999);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("only emits throttled process:output events (not one per chunk)", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = makeFakeChild(1);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    // First chunk always emits (lastEmitMs starts at 0). The second, fired
    // immediately after, falls inside the 250ms throttle window and is dropped.
    child.stdout.emit("data", Buffer.from("chunk one"));
    child.stdout.emit("data", Buffer.from("chunk two"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("caps the rolling output buffer at 8KB", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(1);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("a".repeat(9000)));
    expect(runner.getProcessOutput(processId)?.length).toBe(8 * 1024);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns the in-memory rolling buffer for an active process", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = makeFakeChild(1);
    mockedSpawn.mockReturnValue(child as never);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 10_000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("live output"));

    expect(runner.getProcessOutput(processId)).toBe("live output");

    child.emit("close", 0);
    await promise;
  });

  it("falls back to reading the log file (tail) for a finished process", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("x".repeat(9000));

    const output = runner.getProcessOutput("finished-process-id");
    expect(output?.length).toBe(8 * 1024);
  });

  it("returns null when the log file does not exist", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    mockedExistsSync.mockReturnValue(false);

    expect(runner.getProcessOutput("unknown-process-id")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(runner.getProcessOutput("unreadable-process-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    mockedReaddirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    mockedReaddirSync.mockReturnValue(["done.json"] as never);
    mockedReadFileSync.mockImplementation(() =>
      JSON.stringify({ id: "p1", pid: 1, command: "x", runId: "r1", stage: "s", runtime: "codex", startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }),
    );

    runner.rehydrateOrphans();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest crashed when its process is no longer alive", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    mockedReaddirSync.mockReturnValue(["dead.json"] as never);
    mockedReadFileSync.mockImplementation(() =>
      JSON.stringify({ id: "p-dead", pid: 42, command: "x", runId: "r1", stage: "s", runtime: "codex", startedAt: new Date().toISOString() }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p-dead", pid: 42 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("dead.json"),
      expect.stringContaining('"crashed": true'),
    );
    killSpy.mockRestore();
  });

  it("rehydrates, tails, and later finalizes an orphan whose process is still alive", () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    mockedReaddirSync.mockReturnValue(["alive.json"] as never);
    const manifest = {
      id: "p-alive",
      pid: 777,
      command: "claude",
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
    };

    let logContent = "initial log\n";
    mockedReadFileSync.mockImplementation((_path: unknown, encoding?: unknown) => {
      if (encoding === "utf-8") {
        if (String(_path).endsWith("alive.json")) return JSON.stringify(manifest);
        return logContent;
      }
      return Buffer.from(logContent);
    });

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });

    const fakeWatcher = { close: vi.fn() };
    mockedWatch.mockReturnValue(fakeWatcher as never);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p-alive", pid: 777 }),
      "Rehydrating orphaned agent process",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      "p-alive",
      "executor",
      "claude-code",
      "claude",
    );
    expect(mockedWatch).toHaveBeenCalledTimes(1);

    // Simulate the log file growing and the fs.watch callback firing.
    logContent += "more output appended";
    const watchCallback = mockedWatch.mock.calls[0]![1] as () => void;
    watchCallback();
    expect(runner.getProcessOutput("p-alive")).toContain("more output appended");

    // Now simulate the process disappearing; the 5s poll interval should finalize it.
    alive = false;
    vi.advanceTimersByTime(5_000);

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      "p-alive",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p-alive", pid: 777 }),
      "Orphaned process has exited",
    );

    killSpy.mockRestore();
    vi.clearAllTimers();
  });

  it("ignores a stale fs.watch callback once the orphan has already been finalized, and skips re-buffering when the file has not grown", () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    mockedReaddirSync.mockReturnValue(["alive.json"] as never);
    const manifest = {
      id: "p-alive",
      pid: 778,
      command: "claude",
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
    };

    const logContent = "initial log\n";
    mockedReadFileSync.mockImplementation((_path: unknown, encoding?: unknown) => {
      if (encoding === "utf-8") {
        if (String(_path).endsWith("alive.json")) return JSON.stringify(manifest);
        return logContent;
      }
      return Buffer.from(logContent);
    });

    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true as never);
    const fakeWatcher = { close: vi.fn() };
    mockedWatch.mockReturnValue(fakeWatcher as never);

    runner.rehydrateOrphans();
    const watchCallback = mockedWatch.mock.calls[0]![1] as () => void;

    // File content unchanged: the watcher fires but there's nothing new to
    // append, so appendToBuffer is skipped.
    watchCallback();
    expect(runner.getProcessOutput("p-alive")).toBe("initial log\n");

    // The active process entry disappears (e.g. explicit completion via the
    // normal exec() path) before a second, stale watch callback fires.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "p-alive",
    );
    watchCallback();
    expect(fakeWatcher.close).toHaveBeenCalled();

    killSpy.mockRestore();
    vi.clearAllTimers();
  });

  it("logs a warning and continues when a manifest file is malformed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    mockedReaddirSync.mockReturnValue(["broken.json"] as never);
    mockedReadFileSync.mockImplementation(() => "not valid json{{{");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });
});
