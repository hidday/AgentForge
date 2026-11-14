import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ProcessContext, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

const mkdirSync = vi.fn();
const createWriteStream = vi.fn();
const readFileSync = vi.fn();
const readdirSync = vi.fn();
const writeFileSync = vi.fn();
const existsSync = vi.fn();
const watchMock = vi.fn();

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
  createWriteStream: (...args: unknown[]) => createWriteStream(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
  readdirSync: (...args: unknown[]) => readdirSync(...args),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
  existsSync: (...args: unknown[]) => existsSync(...args),
  watch: (...args: unknown[]) => watchMock(...args),
}));

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
  });
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

function makeLogStream() {
  return { write: vi.fn(), end: vi.fn() };
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: ["--print"],
    cwd: "/repo",
    timeoutMs: 10_000,
    ...overrides,
  };
}

const context: ProcessContext = { runId: "run-1", stage: "planner", runtime: "claude-code" };

beforeEach(() => {
  mkdirSync.mockReset();
  createWriteStream.mockReset().mockReturnValue(makeLogStream());
  readFileSync.mockReset();
  readdirSync.mockReset();
  writeFileSync.mockReset();
  existsSync.mockReset();
  watchMock.mockReset().mockReturnValue({ close: vi.fn() });
  spawnMock.mockReset();
});

describe("ProcessRunner construction", () => {
  it("ensures the spool directory exists on construction", () => {
    new ProcessRunner("mock", makeLogger() as never);
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining("processes"), {
      recursive: true,
    });
  });
});

describe("ProcessRunner.execute in mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    const handler = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions());

    expect(result.stdout).toBe("ok");
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: "claude" }));
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns null when no active entry and no log file exists", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    existsSync.mockReturnValue(false);
    expect(runner.getProcessOutput("missing")).toBeNull();
  });

  it("reads and tails the log file when the process is no longer active", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue("a".repeat(10) + "tail-content");

    const output = runner.getProcessOutput("proc-1");

    expect(output).toContain("tail-content");
  });

  it("returns null when reading the log file throws", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    existsSync.mockReturnValue(true);
    readFileSync.mockImplementation(() => {
      throw new Error("read error");
    });

    expect(runner.getProcessOutput("proc-1")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    killSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("returns silently when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that are already marked completed", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    readdirSync.mockReturnValue(["done.json"]);
    readFileSync.mockReturnValue(JSON.stringify({ id: "p1", completedAt: "2026-01-01T00:00:00Z" }));

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks an orphan with a dead pid as crashed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never);
    readdirSync.mockReturnValue(["orphan.json"]);
    const manifest = {
      id: "p1",
      pid: 99999,
      command: "claude",
      args: [],
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/p1.log",
    };
    readFileSync.mockReturnValue(JSON.stringify(manifest));
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("no such process");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p1" }),
      "Orphaned agent process is dead, marking crashed",
    );
    const written = JSON.parse(writeFileSync.mock.calls[0][1] as string);
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);
  });

  it("rehydrates an orphan with a live pid into active processes and emits process:started", () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("mock", logger as never, emitter as never);
    readdirSync.mockReturnValue(["orphan.json"]);
    const manifest = {
      id: "p1",
      pid: 12345,
      command: "claude",
      args: [],
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/p1.log",
    };
    readFileSync.mockImplementation((path: string) => {
      if (path.endsWith(".json")) return JSON.stringify(manifest);
      return "existing log content";
    });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      "p1",
      "planner",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Simulate the process dying on the next liveness poll so the interval
    // and fs.watch handle created by tailLogForOrphan are cleaned up.
    killSpy.mockImplementation(() => {
      throw new Error("gone");
    });
    vi.advanceTimersByTime(5_000);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      "p1",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("logs a warning and continues when a manifest file is malformed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never);
    readdirSync.mockReturnValue(["bad.json"]);
    readFileSync.mockReturnValue("{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });
});

describe("ProcessRunner.execute in real mode", () => {
  let child: FakeChildProcess;

  beforeEach(() => {
    child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
  });

  it("resolves with concatenated stdout/stderr and exit code on close", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions());

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

  it("writes stdinData to the child and closes stdin", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions({ stdinData: "some input" }));
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("some input");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("closes stdin without writing when there is no stdinData", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions());
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("defaults a null close code to exit code 1", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an error", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions());
    child.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });

  it("tracks an active process, writes a manifest, and emits process:started when a context is given", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const promise = runner.execute(baseOptions({ context }));

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(writeFileSync).toHaveBeenCalledTimes(1);

    const startManifest = JSON.parse(writeFileSync.mock.calls[0][1] as string);
    readFileSync.mockReturnValue(JSON.stringify(startManifest));

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("does not track a process or write a manifest when no context is given", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const promise = runner.execute(baseOptions());

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("exposes live output for an active process via getProcessOutput and getActiveProcesses", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions({ context }));

    child.stdout.emit("data", Buffer.from("partial output"));

    const [active] = runner.getActiveProcesses();
    expect(active.runId).toBe("run-1");
    expect(active.stage).toBe("planner");
    expect(runner.getProcessOutput(active.id)).toBe("partial output");

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions within the throttle window", async () => {
    vi.useFakeTimers();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const promise = runner.execute(baseOptions({ context }));

    child.stdout.emit("data", Buffer.from("chunk1"));
    child.stdout.emit("data", Buffer.from("chunk2"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    child.stdout.emit("data", Buffer.from("chunk3"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
    vi.useRealTimers();
  });

  it("kills the process on timeout, rejects with AgentTimeoutError, then escalates to SIGKILL", async () => {
    vi.useFakeTimers();
    // Simulate a SIGTERM that does not actually mark the child as killed
    // (e.g. the process ignored it), so the runner must escalate.
    child.kill = vi.fn();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);
    const promise = runner.execute(baseOptions({ timeoutMs: 1_000, context }));

    vi.advanceTimersByTime(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });

  it("does not escalate to SIGKILL if the child was already killed", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never);
    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));

    vi.advanceTimersByTime(1_000);
    child.killed = true;
    vi.advanceTimersByTime(5_000);

    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });
});
