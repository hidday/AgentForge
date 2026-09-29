import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

// ---- node:child_process mock -------------------------------------------------

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ---- node:fs mock -------------------------------------------------------------

const fsMocks = {
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
};
vi.mock("node:fs", () => ({
  mkdirSync: (...a: unknown[]) => fsMocks.mkdirSync(...a),
  createWriteStream: (...a: unknown[]) => fsMocks.createWriteStream(...a),
  readFileSync: (...a: unknown[]) => fsMocks.readFileSync(...a),
  readdirSync: (...a: unknown[]) => fsMocks.readdirSync(...a),
  writeFileSync: (...a: unknown[]) => fsMocks.writeFileSync(...a),
  existsSync: (...a: unknown[]) => fsMocks.existsSync(...a),
  watch: (...a: unknown[]) => fsMocks.watch(...a),
}));

// ---- fixtures -----------------------------------------------------------------

class FakeChildProcess extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = { write: vi.fn(), end: vi.fn() };
  public pid = 4242;
  public killed = false;
  public kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 5_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMocks.existsSync.mockReturnValue(false);
  fsMocks.createWriteStream.mockReturnValue({ write: vi.fn(), end: vi.fn() });
  fsMocks.watch.mockReturnValue({ close: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("ensures the spool directory exists on construction", () => {
    new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool-dir");
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("spool-dir"), {
      recursive: true,
    });
  });
});

describe("ProcessRunner.execute() — real mode, successful exit", () => {
  it("resolves with captured stdout/stderr, exit code 0, and timedOut:false", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions());
    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] }),
    );

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("a warning"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "a warning",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
  });

  it("merges extra env vars with process.env when spawning", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ env: { MY_FLAG: "1" } }));
    const [, , spawnOpts] = spawnMock.mock.calls[0]! as [string, string[], { env: Record<string, string> }];
    expect(spawnOpts.env.MY_FLAG).toBe("1");
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.execute() — real mode, non-zero exit", () => {
  it("resolves (does not reject) with the non-zero exit code and captured output", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ command: "false", args: [] }));
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 3);

    const result = await promise;
    expect(result).toEqual({
      stdout: "",
      stderr: "boom",
      exitCode: 3,
      durationMs: expect.any(Number),
      timedOut: false,
    });
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });
});

describe("ProcessRunner.execute() — real mode, stdin handling", () => {
  it("writes stdinData to the child process stdin and ends it", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ stdinData: "hello-stdin" }));
    expect(child.stdin.write).toHaveBeenCalledWith("hello-stdin");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions());
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.execute() — real mode, timeout handling", () => {
  it("kills the process with SIGTERM and rejects with AgentTimeoutError when timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    vi.advanceTimersByTime(1_000);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate the process actually exiting once it receives SIGTERM.
    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", timeoutMs: 1_000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL if the process has not been killed 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // Simulate a kill() call that does not actually flip `killed` (e.g. process
    // is unresponsive to SIGTERM), so the escalation branch fires.
    child.kill = vi.fn().mockReturnValue(true);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    vi.advanceTimersByTime(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when the child reports killed:true after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess(); // default kill() sets killed = true
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(5_000);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses the runtime/stage label instead of the raw command when context is provided", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 1_000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      }),
    );
    vi.advanceTimersByTime(1_000);
    child.emit("close", null);

    try {
      await promise;
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AgentTimeoutError);
      expect((err as AgentTimeoutError).agent).toBe("claude-code/executor");
    }
  });
});

describe("ProcessRunner.execute() — real mode, spawn error path", () => {
  it("rejects with the underlying error when the child process emits 'error' (e.g. ENOENT)", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute(baseOptions({ command: "does-not-exist" }));
    const err = Object.assign(new Error("spawn does-not-exist ENOENT"), { code: "ENOENT" });
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("cleans up the tracked process entry when an error occurs after context tracking started", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = {
      emitProcessStarted: vi.fn(),
      emitProcessOutput: vi.fn(),
      emitProcessCompleted: vi.fn(),
    };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/spool");

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);

    const err = new Error("spawn failure");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
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

describe("ProcessRunner.execute() — mock mode", () => {
  it("throws when mock mode is enabled but no handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and never spawns a real process", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    const handlerResult = {
      stdout: "mock output",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions());

    expect(result).toEqual(handlerResult);
    expect(handler).toHaveBeenCalledWith(baseOptions());
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("exercises the mock CLI fixture handler for a planner-stage claude prompt", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    runner.setMockHandler(createMockProcessHandler());

    const result = await runner.execute(
      baseOptions({
        command: "claude",
        stdinData: "You are the planner. Produce an implementation plan.",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('"stage": "planner"');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns a changes_requested review on the first codex code-review call and approved on the second", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    runner.setMockHandler(createMockProcessHandler());

    const first = await runner.execute(
      baseOptions({ command: "codex", stdinData: "please review this diff" }),
    );
    const second = await runner.execute(
      baseOptions({ command: "codex", stdinData: "please review this diff" }),
    );

    expect(first.stdout).toContain("changes_requested");
    expect(second.stdout).toContain("approved");
  });
});

describe("ProcessRunner.getActiveProcesses() / getProcessOutput()", () => {
  it("tracks a context-tracked process while it runs and clears it on completion", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = {
      emitProcessStarted: vi.fn(),
      emitProcessOutput: vi.fn(),
      emitProcessCompleted: vi.fn(),
    };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/spool");

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "echo",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      "echo",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from("hello"));
    expect(runner.getProcessOutput(active[0]!.id)).toBe("hello");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("truncates the in-memory rolling buffer to the max size", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );
    const [{ id }] = runner.getActiveProcesses();

    const bigChunk = "x".repeat(9 * 1024);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const buffered = runner.getProcessOutput(id);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBe(8 * 1024);

    child.emit("close", 0);
    await promise;
  });

  it("getProcessOutput reads from the log file when the process is no longer active", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue("persisted log tail");
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    expect(runner.getProcessOutput("some-id")).toBe("persisted log tail");
  });

  it("getProcessOutput returns null when there is no active entry and no log file", () => {
    fsMocks.existsSync.mockReturnValue(false);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("getProcessOutput returns null when reading the log file throws", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("EIO");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    expect(runner.getProcessOutput("some-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    fsMocks.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have a completedAt", () => {
    fsMocks.readdirSync.mockReturnValue(["done.json"]);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ completedAt: "2024-01-01T00:00:00Z" }));
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    runner.rehydrateOrphans();

    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("marks a dead orphan process as crashed", () => {
    const manifest = {
      id: "p1",
      pid: 999,
      command: "echo",
      args: [],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "p1.log",
    };
    fsMocks.readdirSync.mockReturnValue(["p1.json"]);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool");

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p1", pid: 999, stage: "executor" }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    const [, writtenJson] = fsMocks.writeFileSync.mock.calls[0]! as [string, string];
    const written = JSON.parse(writtenJson) as { crashed: boolean; exitCode: number };
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);

    killSpy.mockRestore();
  });

  it("rehydrates an alive orphan process, tracks it, and emits process-started", () => {
    const manifest = {
      id: "p2",
      pid: 123,
      command: "echo",
      args: [],
      runId: "r2",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "p2.log",
    };
    fsMocks.readdirSync.mockReturnValue(["p2.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith("p2.json")) return JSON.stringify(manifest);
      return "existing log content";
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = {
      emitProcessStarted: vi.fn(),
      emitProcessOutput: vi.fn(),
      emitProcessCompleted: vi.fn(),
    };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/spool");

    vi.useFakeTimers();
    runner.rehydrateOrphans();
    vi.useRealTimers();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith("r2", "p2", "executor", "claude-code", "echo");
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("p2")).toBe("existing log content");

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file cannot be parsed", () => {
    fsMocks.readdirSync.mockReturnValue(["bad.json"]);
    fsMocks.readFileSync.mockReturnValue("not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });

  it("ignores non-.json files in the spool directory", () => {
    fsMocks.readdirSync.mockReturnValue(["notes.txt", "p3.json"]);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ completedAt: "done" }));
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");

    runner.rehydrateOrphans();

    expect(fsMocks.readFileSync).toHaveBeenCalledTimes(1);
  });

  it("tails an alive orphan's growing log file and finalizes it once the process disappears", () => {
    const manifest = {
      id: "p4",
      pid: 555,
      command: "echo",
      args: [],
      runId: "r4",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "p4.log",
    };
    fsMocks.readdirSync.mockReturnValue(["p4.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith("p4.json")) return JSON.stringify(manifest);
      return "initial";
    });

    let watchCallback: (() => void) | undefined;
    const watcherClose = vi.fn();
    fsMocks.watch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });

    let killShouldThrow = false;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (killShouldThrow) throw new Error("ESRCH");
      return true as never;
    });

    const emitter = {
      emitProcessStarted: vi.fn(),
      emitProcessOutput: vi.fn(),
      emitProcessCompleted: vi.fn(),
    };
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool");

    vi.useFakeTimers();
    runner.rehydrateOrphans();

    // The log file grows -- the watcher callback appends only the new tail.
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith("p4.json")) return JSON.stringify(manifest);
      return "initial + more content";
    });
    watchCallback?.();
    expect(runner.getProcessOutput("p4")).toBe("initial + more content");

    // A second callback with no new bytes hits the "no growth" branch (no-op).
    watchCallback?.();
    expect(runner.getProcessOutput("p4")).toBe("initial + more content");

    // The next poll interval finds the pid gone -> finalizes the orphan.
    killShouldThrow = true;
    vi.advanceTimersByTime(5_000);

    expect(watcherClose).toHaveBeenCalledTimes(1);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r4",
      "p4",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "p4", pid: 555 }),
      "Orphaned process has exited",
    );

    // A late watch callback after the entry is gone just closes the watcher and returns.
    watchCallback?.();
    expect(watcherClose).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    killSpy.mockRestore();
  });

  it("ignores a watch callback error when the log file cannot be read mid-tail", () => {
    const manifest = {
      id: "p5",
      pid: 777,
      command: "echo",
      args: [],
      runId: "r5",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "p5.log",
    };
    fsMocks.readdirSync.mockReturnValue(["p5.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith("p5.json")) return JSON.stringify(manifest);
      return "initial";
    });

    let watchCallback: (() => void) | undefined;
    fsMocks.watch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);

    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");
    vi.useFakeTimers();
    runner.rehydrateOrphans();

    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith("p5.json")) return JSON.stringify(manifest);
      throw new Error("EIO transient read failure");
    });

    expect(() => watchCallback?.()).not.toThrow();
    // Buffer is unchanged since the read failed.
    expect(runner.getProcessOutput("p5")).toBe("initial");

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tolerates a missing log file and a missing manifest across the orphan tail/finalize lifecycle", () => {
    const manifestJson = JSON.stringify({
      id: "p6",
      pid: 888,
      command: "echo",
      args: [],
      runId: "r6",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "p6.log",
    });
    let jsonReadCount = 0;
    fsMocks.readdirSync.mockReturnValue(["p6.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (String(path).endsWith(".json")) {
        jsonReadCount += 1;
        // First read is rehydrateOrphans() loading the manifest; simulate the
        // manifest file disappearing by the time finalizeOrphan() re-reads it.
        if (jsonReadCount === 1) return manifestJson;
        throw new Error("manifest file missing");
      }
      // The log file itself never got created.
      throw new Error("ENOENT: no log file yet");
    });
    fsMocks.watch.mockReturnValue({ close: vi.fn() });
    let killCallCount = 0;
    vi.spyOn(process, "kill").mockImplementation(() => {
      killCallCount += 1;
      // First call is rehydrateOrphans()'s initial liveness probe (process is
      // alive); the poll interval's later calls find it gone.
      if (killCallCount === 1) return true as never;
      throw new Error("ESRCH");
    });

    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/spool");
    vi.useFakeTimers();
    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(1);

    // The first poll finds the pid gone and finalizes it despite the missing manifest.
    vi.advanceTimersByTime(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
