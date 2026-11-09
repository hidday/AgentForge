import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Only `watch` is faked — everything else keeps its real implementation so
// that the manifest/log files ProcessRunner reads and writes under the temp
// spool dir behave normally. Faking `watch` avoids opening a real OS-level
// filesystem watcher (which would otherwise keep the test process alive /
// risk flakiness in sandboxed environments).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn() };
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

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
  spawnMock.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Give any writes queued via createWriteStream (opened asynchronously) a
  // chance to settle before the temp spool dir is removed, so we don't race
  // an fs.open against rmSync and produce an unhandled ENOENT.
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

describe("ProcessRunner — mock mode", () => {
  it("delegates to the configured mock handler and logs the invocation", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked out",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });

    expect(result.stdout).toBe("mocked out");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"] }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo" }),
      "Executing mock process",
    );
  });

  it("throws if mock mode is enabled but no handler was configured", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner — real mode: execute()", () => {
  it("resolves with captured stdout/stderr and exit code 0 on success", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "mytool",
      args: ["--flag"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: x"));
    child.emit("close", 0);

    const result = await promise;

    expect(result).toMatchObject({
      stdout: "hello world",
      stderr: "warn: x",
      exitCode: 0,
      timedOut: false,
    });
    expect(typeof result.durationMs).toBe("number");
    expect(spawnMock).toHaveBeenCalledWith(
      "mytool",
      ["--flag"],
      expect.objectContaining({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.anything(), "Process completed");
  });

  it("writes stdinData and closes stdin when provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "mytool",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "the prompt",
    });

    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("the prompt");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("closes stdin without writing when no stdinData is provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "mytool", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("resolves with a non-zero exit code and surfaces stderr without rejecting", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "mytool", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when close is emitted with a null code", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "mytool", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the spawn error when the child process errors (e.g. ENOENT)", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const enoent = Object.assign(new Error("spawn mytool ENOENT"), { code: "ENOENT" });
    const promise = runner.execute({ command: "mytool", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("error", enoent);

    await expect(promise).rejects.toThrow("spawn mytool ENOENT");
  });

  it("kills the process and rejects with AgentTimeoutError when the timeout elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "slowtool",
      args: [],
      cwd: "/tmp",
      timeoutMs: 100,
      context: { runId: "run-1", stage: "executor", runtime: "codex" },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "Process timed out");
  });

  it("escalates to SIGKILL if the process has not died 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // Override kill so the first call (SIGTERM) does NOT mark it killed,
    // simulating a process that ignores the signal.
    child.kill = vi.fn(() => true);
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "stucktool",
      args: [],
      cwd: "/tmp",
      timeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("tracks an active process while running and emits lifecycle events via the emitter", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "mytool",
      args: ["a"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-9", stage: "planner", runtime: "claude-code" },
    });

    // Give the synchronous spawn setup a chance to register the active process.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "mytool",
      runId: "run-9",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      active[0]!.id,
      "planner",
      "claude-code",
      "mytool",
    );

    const processId = active[0]!.id;
    expect(runner.getProcessOutput(processId)).toBe("");

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(processId)).toBe("partial output");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("throttles emitted output chunks and truncates the rolling buffer beyond the max size", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "chatty",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-x", stage: "executor", runtime: "codex" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;

    // A very large chunk should get truncated to the rolling buffer max.
    const bigChunk = "y".repeat(9 * 1024);
    child.stdout.emit("data", Buffer.from(bigChunk));
    expect(runner.getProcessOutput(processId)!.length).toBe(8 * 1024);

    // First emit happens immediately (lastEmitMs starts at 0); a second,
    // immediately-following chunk should be throttled and not emit again.
    child.stdout.emit("data", Buffer.from("more"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — getProcessOutput()", () => {
  it("returns null when there is no active entry and no log file on disk", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads the tail of an on-disk log file when there is no active entry", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "finished-proc.log"), "line one\nline two\n");

    expect(runner.getProcessOutput("finished-proc")).toBe("line one\nline two\n");
  });
});

describe("ProcessRunner — rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, join(spoolDir, "missing-nested"));
    // Remove the dir that the constructor just created so readdirSync fails... but
    // constructor already mkdir'd it recursively, so instead point at a path
    // that is a file, not a directory, to force readdirSync to throw.
    rmSync(join(spoolDir, "missing-nested"), { recursive: true, force: true });
    writeFileSync(join(spoolDir, "missing-nested"), "not a directory");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a dead orphaned process as crashed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: 999999,
        command: "x",
        args: [],
        runId: "r1",
        stage: "s1",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 999999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file is corrupted", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "bad.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphaned process, then finalizes it once polling detects it died", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-proc.log");
    writeFileSync(logPath, "previous output\n");

    const manifestPath = join(spoolDir, "alive-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive-proc",
        pid: 55555,
        command: "mytool",
        args: ["--x"],
        runId: "run-7",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher = { close: vi.fn() };
    const watchMock = watch as unknown as ReturnType<typeof vi.fn>;
    watchMock.mockReturnValue(fakeWatcher);

    // First call is the initial liveness check in rehydrateOrphans (alive);
    // the second is the first 5s poll tick, simulating the process having
    // died in the meantime.
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => true as never)
      .mockImplementationOnce(() => {
        throw new Error("ESRCH");
      });

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-proc", pid: 55555 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-7",
      "alive-proc",
      "executor",
      "claude-code",
      "mytool",
    );
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive-proc", runId: "run-7" });
    expect(runner.getProcessOutput("alive-proc")).toBe("previous output\n");

    // Advance past the first 5s poll tick -> process.kill throws -> finalize.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-7",
      "alive-proc",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { processId: "alive-proc", pid: 55555 },
      "Orphaned process has exited",
    );

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updatedManifest.exitCode).toBe(-1);
    expect(updatedManifest.completedAt).toBeDefined();

    killSpy.mockRestore();
  });
});
