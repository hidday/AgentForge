import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// ---- node:child_process mock ----------------------------------------------

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    return true;
  });
}

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ---- node:fs mock -----------------------------------------------------------

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  createWriteStream: vi.fn(),
  watch: vi.fn(),
}));
vi.mock("node:fs", () => fsMock);

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

function makeWriteStream() {
  return { write: vi.fn(), end: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(false);
  fsMock.readdirSync.mockReturnValue([]);
  fsMock.createWriteStream.mockImplementation(() => makeWriteStream());
  fsMock.watch.mockReturnValue({ close: vi.fn() });
  spawnMock.mockImplementation(() => new FakeChildProcess());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("creates the spool directory on construction", () => {
    const logger = makeMockLogger();
    new ProcessRunner("mock", logger as never, undefined, "/tmp/my-spool");
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("my-spool"),
      { recursive: true },
    );
  });
});

describe("ProcessRunner.execute() — mock mode", () => {
  it("throws when no mock handler has been registered", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the registered mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    const handlerResult = {
      stdout: "mocked out",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const options = { command: "claude", args: ["--version"], cwd: "/tmp", timeoutMs: 1000 };
    const result = await runner.execute(options);

    expect(result).toBe(handlerResult);
    expect(handler).toHaveBeenCalledWith(options);
  });
});

describe("ProcessRunner.execute() — real mode", () => {
  it("resolves with stdout/stderr/exitCode 0 on a clean close", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });

    const promise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
  });

  it("resolves (does not reject) with the given exit code on a non-zero close", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });

    const promise = runner.execute({
      command: "codex",
      args: ["exec", "-"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("rejects when spawn emits an 'error' event", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });

    const promise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    const spawnError = new Error("ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toBe(spawnError);
  });

  it("writes stdinData to the child's stdin and ends it when provided", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "prompt text",
    });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("tracks an active process, emits process:started, writes a manifest, and cleans up on close", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as unknown as RunEventEmitter);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });
    const writeStream = makeWriteStream();
    fsMock.createWriteStream.mockReturnValue(writeStream);

    const promise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    // While active: getActiveProcesses reflects the entry.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      "claude",
    );
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`${active[0]!.id}.json`),
      expect.stringContaining('"runId": "run-1"'),
    );

    // getProcessOutput reads the live rolling buffer while active.
    child.stdout.emit("data", Buffer.from("some output"));
    expect(runner.getProcessOutput(active[0]!.id)).toContain("some output");
    expect(writeStream.write).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(writeStream.end).toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("cleans up the active entry and reports exitCode -1 when spawn errors with a tracked context", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as unknown as RunEventEmitter);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      return child;
    });
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ id: "whatever", pid: 1, command: "claude", args: [], runId: "run-2", stage: "planner", runtime: "claude-code", startedAt: new Date().toISOString(), logFile: "x" }),
    );

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "planner", runtime: "claude-code" },
    });

    const err = new Error("spawn EACCES");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-2",
      expect.any(String),
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("kills the child with SIGTERM then SIGKILL and rejects with AgentTimeoutError once the process closes", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      // Simulate a hung process: kill() does not actually terminate it.
      child.kill = vi.fn(() => true);
      return child;
    });

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
    });
    // Swallow the eventual rejection so it isn't reported as unhandled while
    // we're still advancing timers below.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.killed).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    await expect(promise).rejects.toMatchObject({ agent: "claude-code/executor", timeoutMs: 1000 });
  });

  it("does not send SIGKILL if the child is already killed by the time the grace period elapses", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    let child!: FakeChildProcess;
    spawnMock.mockImplementation(() => {
      child = new FakeChildProcess();
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });
      return child;
    });

    const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.killed).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    // Still only the one SIGTERM call — SIGKILL was skipped.
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null when the process is neither active nor logged to disk", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    fsMock.existsSync.mockReturnValue(false);

    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("falls back to reading the log file (tail-sliced) when the process isn't active", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("log file contents");

    const output = runner.getProcessOutput("archived-id");
    expect(output).toBe("log file contents");
    expect(fsMock.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("archived-id.log"),
      "utf-8",
    );
  });

  it("returns null when the log file exists but cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    fsMock.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have completedAt set", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as unknown as RunEventEmitter,
    );
    fsMock.readdirSync.mockReturnValue(["done.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        id: "done",
        pid: 1,
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

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates a manifest whose pid is still alive and emits process:started", () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as unknown as RunEventEmitter,
    );

    const manifest = {
      id: "alive-1",
      pid: 999,
      command: "claude",
      args: ["--version"],
      runId: "run-alive",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/spool/alive-1.log",
    };
    fsMock.readdirSync.mockReturnValue(["alive-1.json"]);
    fsMock.readFileSync.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith(".json")) return JSON.stringify(manifest);
      return "existing log content";
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const writeStream = makeWriteStream();
    fsMock.createWriteStream.mockReturnValue(writeStream);

    runner.rehydrateOrphans();

    expect(killSpy).toHaveBeenCalledWith(999, 0);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive-1",
      "planner",
      "claude-code",
      "claude",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: 999 }),
      "Rehydrating orphaned agent process",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive-1", pid: 999, runId: "run-alive" });

    killSpy.mockRestore();
  });

  it("marks a manifest crashed and rewrites it to disk when its pid is dead", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as unknown as RunEventEmitter,
    );

    const manifest = {
      id: "dead-1",
      pid: 5555,
      command: "claude",
      args: [],
      runId: "run-dead",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/spool/dead-1.log",
    };
    fsMock.readdirSync.mockReturnValue(["dead-1.json"]);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(killSpy).toHaveBeenCalledWith(5555, 0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 5555 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("dead-1.json"),
      expect.stringContaining('"crashed": true'),
    );

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    fsMock.readdirSync.mockReturnValue(["broken.json"]);
    fsMock.readFileSync.mockReturnValue("{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });
});
