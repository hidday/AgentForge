import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTimeoutError } from "../../src/utils/errors.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: watchMock };
});

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

/** A controllable fake Node ChildProcess for driving executeReal() without spawning anything real. */
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    return true;
  });
}

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

/** A fake fs.watch() return value — just enough to satisfy the .close() call sites. */
function makeFakeWatcher() {
  return { close: vi.fn() };
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  spawnMock.mockReset();
  watchMock.mockReset();
  watchMock.mockReturnValue(makeFakeWatcher());
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Log file writes from createWriteStream() happen asynchronously via the
  // libuv thread pool; give any in-flight opens/writes from this test a
  // chance to settle before the directory they target disappears, so a
  // late open doesn't surface as an unhandled ENOENT in a later test.
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner — mock mode", () => {
  it("throws if execute() is called in mock mode with no handler configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and never spawns a real process", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({ command: "x", args: ["y"], cwd: "/tmp", timeoutMs: 1000 });

    expect(result.stdout).toBe("mocked");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "x", args: ["y"], cwd: "/tmp" }),
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — executeReal() success/failure paths", () => {
  it("resolves with concatenated stdout/stderr and exitCode 0 on a clean exit, tracking and then clearing the active process", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      "echo",
    );
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    // While still running, it should show up as an active process.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: processId, pid: child.pid, command: "echo", runId: "run-1" });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stderr.emit("data", Buffer.from("warn "));
    child.stdout.emit("data", Buffer.from("world"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn ",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });

    // Process is no longer tracked as active once it completes.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifest = JSON.parse(readFileSync(join(spoolDir, `${processId}.json`), "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);
  });

  it("resolves (does not reject) with a non-zero exitCode", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 2 }),
      "Process completed",
    );
  });

  it("defaults exitCode to 1 when close is emitted with a null code", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("does not create manifest/log files or track an active process when no context is given", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("writes stdinData to the child's stdin and ends it when provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "payload",
    });
    expect(child.stdin.write).toHaveBeenCalledWith("payload");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin directly without writing when no stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("is safe if Node emits both 'error' and 'close' for the same child (cleanup runs only once)", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "bad-command",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-double", stage: "executor", runtime: "codex" },
    });

    child.emit("error", new Error("spawn failed"));
    await expect(promise).rejects.toThrow("spawn failed");
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

    // A subsequent 'close' for the same child must not re-run cleanup/emit again.
    expect(() => child.emit("close", 1)).not.toThrow();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
  });

  it("rejects with the spawn error on a child 'error' event and still cleans up the active process", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "bad-command",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-err", stage: "executor", runtime: "codex" },
    });

    const spawnErr = new Error("ENOENT: spawn bad-command");
    child.emit("error", spawnErr);

    await expect(promise).rejects.toThrow("ENOENT: spawn bad-command");
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-err",
      expect.any(String),
      "executor",
      "codex",
      -1,
      expect.any(Number),
    );
  });

  it("still resolves and emits completion even if the manifest file disappears before cleanup writes to it", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-nomanifest", stage: "executor", runtime: "claude-code" },
    });

    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;
    rmSync(join(spoolDir, `${processId}.json`));

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-nomanifest",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("merges extra env vars on top of process.env when spawning", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: ["a"],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { MY_VAR: "1" },
    });
    child.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "x",
      ["a"],
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({ MY_VAR: "1" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });
});

describe("ProcessRunner — timeout handling", () => {
  it("sends SIGTERM when the timeout elapses, escalates to SIGKILL if the process is still alive, and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    // Simulate a kill() that successfully signals but the process does not
    // actually die (killed stays false, mirroring Node's semantics where
    // .killed only flips once a signal was *sent*, not once the process exits).
    child.kill = vi.fn(() => true);
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-to", stage: "executor", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "sleep", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not escalate to SIGKILL when the process reports killed=true after SIGTERM", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    child.kill = vi.fn(() => {
      child.killed = true;
      return true;
    });
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("includes the runtime/stage label in the AgentTimeoutError when context is present", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    child.kill = vi.fn(() => {
      child.killed = true;
      return true;
    });
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-to2", stage: "reviewer", runtime: "codex" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    child.emit("close", null);

    await expect(promise).rejects.toMatchObject({ agent: "codex/reviewer" });
  });
});

describe("ProcessRunner — output buffering and throttled emission", () => {
  it("truncates the rolling buffer to the max size and keeps the tail", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-big", stage: "executor", runtime: "claude-code" },
    });

    const big = "a".repeat(10 * 1024) + "[TAIL]";
    child.stdout.emit("data", Buffer.from(big));

    const [processId] = [...runner.getActiveProcesses()].map((p) => p.id);
    const buffered = runner.getProcessOutput(processId!);
    expect(buffered!.length).toBeLessThanOrEqual(8 * 1024);
    expect(buffered).toContain("[TAIL]");

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions and slices long chunks to the last 500 chars", async () => {
    vi.useFakeTimers();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-throttle", stage: "executor", runtime: "claude-code" },
    });

    const longChunk = "b".repeat(600) + "[END]";
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , firstChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((firstChunk as string).length).toBe(500);
    expect(firstChunk).toContain("[END]");

    // A second chunk arriving immediately after is within the throttle
    // window, so it should not trigger another emission.
    child.stdout.emit("data", Buffer.from("more"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window; the next chunk should emit again.
    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("later"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null when there is no active entry and no log file on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("reads the tail of the on-disk log file when there is no active entry", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const logPath = join(spoolDir, "done-id.log");
    writeFileSync(logPath, "a".repeat(9000) + "[TAIL]");

    const output = runner.getProcessOutput("done-id");
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toContain("[TAIL]");
  });

  it("returns null if the log file exists but cannot be read as a regular file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    // Create a directory at the expected log path so readFileSync throws (EISDIR).
    mkdirSync(join(spoolDir, "weird-id.log"));
    expect(runner.getProcessOutput("weird-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns without throwing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 999999,
        command: "x",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 123456,
        command: "x",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead.log"),
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: 123456 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
  });

  it("logs a warning and continues when a manifest file is malformed JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "bad.json"), "{ not valid json");
    vi.spyOn(process, "kill").mockImplementation(() => true);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphan with no pre-existing log file, resumes tailing, buffers appended growth, and finalizes it once the pid disappears", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "alive.json");
    const logPath = join(spoolDir, "alive.log");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive",
        pid: 55555,
        command: "run-thing",
        args: ["x"],
        runId: "run-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: 55555, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive",
      "executor",
      "claude-code",
      "run-thing",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));

    const watchCallback = watchMock.mock.calls[0]![1] as () => void;

    // Simulate the orphaned process appending more output to its log file.
    writeFileSync(logPath, "chunk-one");
    watchCallback();
    expect(runner.getProcessOutput("alive")).toBe("chunk-one");

    writeFileSync(logPath, "chunk-onechunk-two");
    watchCallback();
    expect(runner.getProcessOutput("alive")).toBe("chunk-onechunk-two");

    // A read error on the watched file (e.g. file removed concurrently) is
    // swallowed and leaves the buffer unchanged.
    rmSync(logPath);
    expect(() => watchCallback()).not.toThrow();
    expect(runner.getProcessOutput("alive")).toBe("chunk-onechunk-two");

    // Now the pid disappears: the 5s poll should finalize the orphan.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-alive",
      "alive",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { processId: "alive", pid: 55555 },
      "Orphaned process has exited",
    );
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBe(-1);
    expect(finalManifest.completedAt).toBeDefined();

    // A late watch callback firing after the entry was already removed just
    // closes the watcher instead of touching state that no longer exists.
    const watcher = watchMock.mock.results[0]!.value as { close: ReturnType<typeof vi.fn> };
    watchCallback();
    expect(watcher.close).toHaveBeenCalled();
  });

  it("finalizes an orphan gracefully even if its manifest file disappears before the finalize write", async () => {
    vi.useFakeTimers();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const manifestPath = join(spoolDir, "alive3.json");
    const logPath = join(spoolDir, "alive3.log");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive3",
        pid: 77777,
        command: "run-thing",
        args: [],
        runId: "run-alive3",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    rmSync(manifestPath);
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-alive3",
      "alive3",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("resumes tailing an alive orphan that already has an existing log file, seeding the rolling buffer from it", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "alive2.json");
    const logPath = join(spoolDir, "alive2.log");
    writeFileSync(logPath, "pre-existing output");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive2",
        pid: 66666,
        command: "run-thing",
        args: [],
        runId: "run-alive2",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("alive2")).toBe("pre-existing output");
  });
});
