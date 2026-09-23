import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn() };
});

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid: number | undefined = 4321;
  killed = false;
  killImmediately: boolean;
  kill: ReturnType<typeof vi.fn>;

  constructor(opts: { pid?: number | undefined; killImmediately?: boolean } = {}) {
    super();
    if ("pid" in opts) this.pid = opts.pid;
    this.killImmediately = opts.killImmediately ?? true;
    this.kill = vi.fn(() => {
      if (this.killImmediately) this.killed = true;
      return true;
    });
  }
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  vi.mocked(spawn).mockReset();
  vi.mocked(watch).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // already removed by a test
  }
});

const baseOptions: ProcessSpawnOptions = {
  command: "some-cli",
  args: ["--flag"],
  cwd: "/tmp",
  timeoutMs: 60_000,
};

describe("ProcessRunner constructor", () => {
  it("creates the spool directory recursively", () => {
    const nested = join(spoolDir, "a", "b", "c");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("mock", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner.execute() — mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions)).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const fakeResult = {
      stdout: "mock stdout",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(fakeResult);
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions);

    expect(result).toBe(fakeResult);
    expect(handler).toHaveBeenCalledWith(baseOptions);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", args: ["--flag"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner.execute() — real mode, basic exit handling", () => {
  it("resolves with captured stdout/stderr and exitCode 0 on a clean exit", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions);
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
      expect.objectContaining({ command: "some-cli", exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves (does not reject) with a non-zero exitCode when the process is not killed for timeout", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions);
    child.emit("close", 1);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions);
    child.emit("close", null);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child's stdin and ends it when stdinData is provided", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({ ...baseOptions, stdinData: "hello agent" });
    expect(child.stdin.write).toHaveBeenCalledWith("hello agent");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    child.emit("close", 0);
    await resultPromise;
  });

  it("just ends stdin without writing when stdinData is absent", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions);
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    child.emit("close", 0);
    await resultPromise;
  });

  it("passes cwd and a merged env (process.env + extraEnv) to spawn", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({
      ...baseOptions,
      cwd: "/repo/checkout",
      env: { CUSTOM_VAR: "abc" },
    });
    child.emit("close", 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      "some-cli",
      ["--flag"],
      expect.objectContaining({
        cwd: "/repo/checkout",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ CUSTOM_VAR: "abc", PATH: process.env.PATH }),
      }),
    );
  });

  it("rejects with the spawn error when the child process emits an 'error' event", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions);
    const spawnError = new Error("ENOENT: spawn some-cli");
    child.emit("error", spawnError);

    await expect(resultPromise).rejects.toBe(spawnError);
  });
});

describe("ProcessRunner.execute() — real mode, timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM once timeoutMs elapses and rejects with AgentTimeoutError (label = command, no context)", async () => {
    const child = new FakeChildProcess({ killImmediately: true });
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const resultPromise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate the child actually exiting once signaled.
    child.emit("close", null);

    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
    await expect(resultPromise).rejects.toThrow(/some-cli/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("uses '<runtime>/<stage>' as the timeout error label when context is provided", async () => {
    const child = new FakeChildProcess({ killImmediately: true });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      timeoutMs: 1000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });
    await vi.advanceTimersByTimeAsync(1000);
    child.emit("close", null);

    await expect(resultPromise).rejects.toThrow(/claude-code\/executor/);
  });

  it("escalates to SIGKILL if the child has not exited 5s after SIGTERM", async () => {
    const child = new FakeChildProcess({ killImmediately: false });
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL if the child already reports killed=true after SIGTERM", async () => {
    const child = new FakeChildProcess({ killImmediately: true });
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    // Still only the one SIGTERM call -- no escalation needed.
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not report timedOut when the process exits cleanly before the timeout fires", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({ ...baseOptions, timeoutMs: 60_000 });
    child.emit("close", 0);
    const result = await resultPromise;

    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    // Advancing time past the timeout afterward must not do anything further
    // (the timer was cleared on close).
    await vi.advanceTimersByTimeAsync(120_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute() — real mode, process context tracking", () => {
  it("tracks an active process, writes a manifest, and emits process:started when context + pid are present", async () => {
    const child = new FakeChildProcess({ pid: 5555 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-42", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "some-cli",
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");

    const processId = active[0]!.id;
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "planner",
      "claude-code",
      "some-cli",
    );

    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({
      id: processId,
      pid: 5555,
      command: "some-cli",
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });

    child.emit("close", 0);
    await resultPromise;

    // Cleaned up after completion.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBe(0);
    expect(finalManifest.completedAt).toEqual(expect.any(String));
  });

  it("does not track a process (no manifest, no active entry) when context is set but child.pid is falsy", async () => {
    const child = new FakeChildProcess({ pid: undefined });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-99", stage: "planner", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    // cleanupProcess(processId, ...) is invoked, but finds no entry and returns
    // silently -- no manifest was ever written to update.
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("gracefully handles a manifest file that disappears before completion (best-effort update)", async () => {
    const child = new FakeChildProcess({ pid: 7777 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-7", stage: "planner", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    rmSync(join(spoolDir, `${processId}.json`), { force: true });

    child.emit("close", 0);
    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    // Completion event still fires even though the manifest update failed.
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });
});

describe("ProcessRunner appendToBuffer() throttling and truncation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  it("emits the first chunk immediately, throttles a chunk arriving <250ms later, then emits again after the window", async () => {
    const child = new FakeChildProcess({ pid: 1111 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-t", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("first chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.stdout.emit("data", Buffer.from("second chunk (too soon)"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_700_000_000_000 + 300);
    child.stdout.emit("data", Buffer.from("third chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await resultPromise;
  });

  it("truncates an emitted chunk to its last 500 characters", async () => {
    const child = new FakeChildProcess({ pid: 2222 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      spoolDir,
    );

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-big", stage: "planner", runtime: "claude-code" },
    });

    const longText = "A".repeat(600) + "[TAIL]";
    child.stdout.emit("data", Buffer.from(longText));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , chunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(chunk.length).toBe(500);
    expect(chunk.endsWith("[TAIL]")).toBe(true);

    child.emit("close", 0);
    await resultPromise;
  });

  it("truncates the in-memory rolling buffer to ROLLING_BUFFER_MAX (8KiB)", async () => {
    const child = new FakeChildProcess({ pid: 3333 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-buf", stage: "planner", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    const bigChunk = "B".repeat(9000) + "[END]";
    child.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output!.endsWith("[END]")).toBe(true);

    child.emit("close", 0);
    await resultPromise;
  });

  it("does not attempt to emit process output when no emitter is configured", async () => {
    const child = new FakeChildProcess({ pid: 4444 });
    vi.mocked(spawn).mockReturnValue(child as never);
    // No emitter passed.
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-noemit", stage: "planner", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("no crash please"));
    expect(runner.getProcessOutput(processId)).toBe("no crash please");

    child.emit("close", 0);
    await resultPromise;
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns the in-memory rolling buffer for an active process", async () => {
    const child = new FakeChildProcess({ pid: 8888 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-a", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("in progress output"));

    expect(runner.getProcessOutput(processId)).toBe("in progress output");

    child.emit("close", 0);
    await resultPromise;
  });

  it("reads from the log file on disk when the process is no longer active", async () => {
    const child = new FakeChildProcess({ pid: 9999 });
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute({
      ...baseOptions,
      context: { runId: "run-b", stage: "planner", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("logged to disk"));
    child.emit("close", 0);
    await resultPromise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(runner.getProcessOutput(processId)).toContain("logged to disk");
  });

  it("returns null when there is no active entry and no log file for the id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("no-such-process-id")).toBeNull();
  });

  it("returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    // Create a *directory* named like the expected log file so existsSync()
    // is true but readFileSync() throws (EISDIR).
    mkdirSync(join(spoolDir, "weird-id.log"));
    expect(runner.getProcessOutput("weird-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have completedAt set", () => {
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
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a dead orphan (process.kill throws) as crashed and updates its manifest", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: 999_999,
        command: "x",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    try {
      runner.rehydrateOrphans();
    } finally {
      killSpy.mockRestore();
    }

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toEqual(expect.any(String));
  });

  it("rehydrates a live orphan into an active process and starts tailing its log", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "live-proc.log");
    writeFileSync(logPath, "existing partial output");
    writeFileSync(
      join(spoolDir, "live-proc.json"),
      JSON.stringify({
        id: "live-proc",
        pid: 424_242,
        command: "claude",
        args: [],
        runId: "run-live",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher = { close: vi.fn() };
    vi.mocked(watch).mockReturnValue(fakeWatcher as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementationOnce(() => true as never);

    try {
      vi.useFakeTimers();
      runner.rehydrateOrphans();
    } finally {
      killSpy.mockRestore();
    }

    expect(runner.getActiveProcesses()).toMatchObject([
      { id: "live-proc", pid: 424_242, runId: "run-live", stage: "planner", runtime: "claude-code" },
    ]);
    expect(runner.getProcessOutput("live-proc")).toBe("existing partial output");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-live",
      "live-proc",
      "planner",
      "claude-code",
      "claude",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live-proc", pid: 424_242 }),
      "Rehydrating orphaned agent process",
    );
    expect(watch).toHaveBeenCalledWith(logPath, expect.any(Function));
  });

  it("rehydrates a live orphan whose log file does not yet exist (initial read is best-effort)", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "no-log-yet.log");
    // Note: logPath is NOT created on disk.
    writeFileSync(
      join(spoolDir, "no-log-yet.json"),
      JSON.stringify({
        id: "no-log-yet",
        pid: 424_243,
        command: "claude",
        args: [],
        runId: "run-live2",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher = { close: vi.fn() };
    vi.mocked(watch).mockReturnValue(fakeWatcher as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementationOnce(() => true as never);

    try {
      vi.useFakeTimers();
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    } finally {
      killSpy.mockRestore();
    }

    expect(runner.getProcessOutput("no-log-yet")).toBe("");
  });
});

describe("ProcessRunner tailLogForOrphan() watch callback and poll interval", () => {
  function rehydrateLiveOrphan(runner: ProcessRunner, logger: ReturnType<typeof makeMockLogger>) {
    const logPath = join(spoolDir, "tail-target.log");
    writeFileSync(logPath, "start");
    writeFileSync(
      join(spoolDir, "tail-target.json"),
      JSON.stringify({
        id: "tail-target",
        pid: 313_131,
        command: "claude",
        args: [],
        runId: "run-tail",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const fakeWatcher = { close: vi.fn() };
    vi.mocked(watch).mockReturnValue(fakeWatcher as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementationOnce(() => true as never);
    try {
      runner.rehydrateOrphans();
    } finally {
      killSpy.mockRestore();
    }

    const [, watchCallback] = vi.mocked(watch).mock.calls[0]!;
    return { logPath, fakeWatcher, watchCallback: watchCallback as () => void };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("appends newly written log content to the buffer when the watch callback fires", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const { logPath, watchCallback } = rehydrateLiveOrphan(runner, logger);

    writeFileSync(logPath, "start + more output");
    watchCallback();

    expect(runner.getProcessOutput("tail-target")).toBe("start + more output");
  });

  it("does nothing on the watch callback when content length has not grown", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const { watchCallback } = rehydrateLiveOrphan(runner, logger);

    // No file change -- content length is unchanged.
    watchCallback();
    expect(runner.getProcessOutput("tail-target")).toBe("start");
  });

  it("closes the watcher and returns when the tracked entry is gone by the time the callback fires", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const { fakeWatcher, watchCallback } = rehydrateLiveOrphan(runner, logger);

    // Force-remove the tracked entry by making the interval poll believe the
    // process died, which finalizes and deletes the active entry.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    killSpy.mockRestore();

    expect(runner.getActiveProcesses()).toHaveLength(0);

    // Now the watcher callback fires with no entry left to update.
    watchCallback();
    expect(fakeWatcher.close).toHaveBeenCalled();
  });

  it("ignores a read error inside the watch callback", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const { logPath, watchCallback } = rehydrateLiveOrphan(runner, logger);

    writeFileSync(logPath, "start + grown");
    rmSync(logPath);
    expect(() => watchCallback()).not.toThrow();
  });

  it("finalizes the orphan (removes entry, updates manifest, emits completed) once process.kill starts throwing", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    rehydrateLiveOrphan(runner, logger);

    expect(runner.getActiveProcesses()).toHaveLength(1);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    killSpy.mockRestore();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-tail",
      "tail-target",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "tail-target", pid: 313_131 }),
      "Orphaned process has exited",
    );

    const manifest = JSON.parse(readFileSync(join(spoolDir, "tail-target.json"), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toEqual(expect.any(String));
  });

  it("keeps polling (no finalize) while process.kill keeps succeeding", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    rehydrateLiveOrphan(runner, logger);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    vi.advanceTimersByTime(5000);
    killSpy.mockRestore();

    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("gracefully handles finalizeOrphan when the manifest file is missing (best-effort update)", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    rehydrateLiveOrphan(runner, logger);

    rmSync(join(spoolDir, "tail-target.json"), { force: true });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    killSpy.mockRestore();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });

  it("finalizeOrphan is a no-op if the entry is already gone", () => {
    const logger = makeMockLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    rehydrateLiveOrphan(runner, logger);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    // First interval tick finalizes and removes the entry, clearing the interval.
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    emitter.emitProcessCompleted.mockClear();

    // Advancing further must not finalize again (interval was cleared).
    vi.advanceTimersByTime(20_000);
    killSpy.mockRestore();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});
