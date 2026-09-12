import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const mockedSpawn = vi.mocked(spawn);

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

interface FakeChild extends EventEmitter {
  pid?: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid: number | undefined = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
  mockedSpawn.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // fs.createWriteStream opens/writes/closes asynchronously; give any
  // in-flight log writes from the test a moment to settle before the spool
  // directory is removed, to avoid spurious ENOENT races.
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(spoolDir, { recursive: true, force: true });
});

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("ProcessRunner constructor", () => {
  it("creates the spool directory if it does not exist", () => {
    const nested = join(spoolDir, "nested", "deeper");
    const logger = makeLogger();
    new ProcessRunner("real", logger as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner.execute in mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and logs a debug line", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions({ command: "fake", args: ["a", "b"] }));

    expect(result.stdout).toBe("mocked");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake", args: ["a", "b"] }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake", args: ["a", "b"] }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner.execute in real mode -- spawning and stdin", () => {
  it("spawns with merged env and pipe stdio, and ends stdin without writing when no stdinData", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ env: { FOO: "bar" } }));
    child.emit("close", 0);
    const result = await promise;

    expect(mockedSpawn).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0, durationMs: expect.any(Number), timedOut: false });
  });

  it("writes stdinData before ending stdin when provided", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "hello stdin" }));
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });
});

describe("ProcessRunner.execute in real mode -- exit codes and stdout/stderr accumulation", () => {
  it("resolves with concatenated stdout/stderr and the exit code on success", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.stdout.emit("data", Buffer.from("out-1 "));
    child.stdout.emit("data", Buffer.from("out-2"));
    child.stderr.emit("data", Buffer.from("err-1"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("out-1 out-2");
    expect(result.stderr).toBe("err-1");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves with the actual non-zero exit code", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 7);
    const result = await promise;

    expect(result.exitCode).toBe(7);
  });

  it("falls back to exit code 1 when close is signaled with a null code", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);
    const result = await promise;

    expect(result.exitCode).toBe(1);
  });

  it("rejects with the spawn error when the child process errors out", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });
});

describe("ProcessRunner.execute in real mode -- timeout and kill escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM at the timeout and rejects with AgentTimeoutError once the process closes", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 1000,
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
      }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    await expect(promise).rejects.toThrow(/claude-code\/planner/);
    await expect(promise).rejects.toThrow(/timed out after 1000ms/);
  });

  it("escalates to SIGKILL if the process has not exited 5s after SIGTERM", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1000 }));
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Process does not honor SIGTERM (child.killed stays false).
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL if the process already exited after SIGTERM", async () => {
    const child = makeFakeChild();
    child.kill.mockImplementation(() => {
      child.killed = true;
    });
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1000 }));
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not report a timeout when the process closes normally before the deadline", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 5000 }));
    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", 0);

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner process tracking -- context, manifests, and output buffering", () => {
  it("writes a manifest and starts an active process entry when context and pid are present", async () => {
    const child = makeFakeChild(555);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({
        command: "claude",
        args: ["--model", "x"],
        context: { runId: "run-42", stage: "planner", runtime: "claude-code" },
      }),
    );

    expect(emitter.emitProcessStarted).toHaveBeenCalledTimes(1);
    const [runId, processId, stage, runtime, command] = emitter.emitProcessStarted.mock.calls[0]!;
    expect(runId).toBe("run-42");
    expect(stage).toBe("planner");
    expect(runtime).toBe("claude-code");
    expect(command).toBe("claude");
    expect(typeof processId).toBe("string");

    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({
      id: processId,
      pid: 555,
      command: "claude",
      args: ["--model", "x"],
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });

    child.emit("close", 0);
    await promise;

    // After close, cleanupProcess finalizes the manifest with completion info.
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("does not register a process entry or write a manifest when context is absent", async () => {
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    const files = existsSync(spoolDir) ? readdirSync(spoolDir) : [];
    expect(files.filter((f: string) => f.endsWith(".json"))).toHaveLength(0);
  });

  it("does not register a process entry when the child has no pid, even with context set", async () => {
    const child = makeFakeChild(0);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "r", stage: "s", runtime: "codex" } }),
    );
    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("accumulates output into the rolling buffer and exposes it via getActiveProcesses/getProcessOutput", async () => {
    const child = makeFakeChild(1);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-x", stage: "executor", runtime: "claude-code" } }),
    );
    promise.catch(() => {});

    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    child.stdout.emit("data", Buffer.from("chunk-1"));

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: processId,
      pid: 1,
      command: "echo",
      runId: "run-x",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(runner.getProcessOutput(processId)).toBe("chunk-1");

    child.emit("close", 0);
    await promise;

    // After completion the process is no longer active, but getProcessOutput
    // falls back to reading the log file from disk once the write stream
    // (opened/flushed asynchronously) has settled.
    expect(runner.getActiveProcesses()).toEqual([]);
    await vi.waitFor(() => {
      expect(runner.getProcessOutput(processId)).toContain("chunk-1");
    });
  });

  it("returns null from getProcessOutput for an unknown process id", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("returns null from getProcessOutput when the log file exists but cannot be read as a file", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    // Create a directory where the runner expects a log *file* -- existsSync
    // is true, but readFileSync will throw (EISDIR), exercising the catch path.
    const trickyId = "tricky-id";
    mkdirSync(join(spoolDir, `${trickyId}.log`));
    expect(runner.getProcessOutput(trickyId)).toBeNull();
  });

  it("trims the rolling buffer to the last 8KB when output exceeds the cap", async () => {
    const child = makeFakeChild(2);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-y", stage: "executor", runtime: "codex" } }),
    );
    promise.catch(() => {});

    const bigChunk = "A".repeat(9000);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(
      // We don't have direct access to processId here without an emitter;
      // fetch it via getActiveProcesses instead.
      runner.getActiveProcesses()[0]!.id,
    );
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toBe(bigChunk.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("throttles emitProcessOutput calls within the 250ms window and slices chunks over 500 chars", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild(3);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-z", stage: "executor", runtime: "codex" } }),
    );
    promise.catch(() => {});

    // First chunk always emits (lastEmitMs starts at 0).
    child.stdout.emit("data", Buffer.from("first-chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Second chunk arrives immediately after -- inside the throttle window.
    child.stdout.emit("data", Buffer.from("second-chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window, then a third chunk should emit again.
    await vi.advanceTimersByTimeAsync(300);
    const longChunk = "Z".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(emittedChunk.length).toBe(500);
    expect(emittedChunk).toBe(longChunk.slice(-500));

    child.emit("close", 0);
    await promise;
    vi.useRealTimers();
  });

  it("cleans up gracefully when the manifest file is missing at close time (best-effort update)", async () => {
    const child = makeFakeChild(9);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-missing", stage: "executor", runtime: "codex" } }),
    );
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;
    rmSync(join(spoolDir, `${processId}.json`));

    child.emit("close", 4);
    const result = await promise;

    expect(result.exitCode).toBe(4);
    // cleanupProcess still emits completion even though the manifest write was skipped.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-missing",
      processId,
      "executor",
      "codex",
      4,
      expect.any(Number),
    );
  });

  it("passes exitCode -1 to cleanup and emits completion with -1 when the child errors", async () => {
    const child = makeFakeChild(11);
    mockedSpawn.mockReturnValue(child as never);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-err", stage: "executor", runtime: "codex" } }),
    );
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    promise.catch(() => {});
    child.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("boom");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-err",
      processId,
      "executor",
      "codex",
      -1,
      expect.any(Number),
    );
    const manifest = JSON.parse(readFileSync(join(spoolDir, `${processId}.json`), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("does nothing (no throw) when the spool directory cannot be read", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files in the spool directory", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "notes.txt"), "hello");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("skips manifests that already have completedAt set", () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    writeFileSync(
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 999999,
        command: "echo",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a manifest as crashed when its pid is not alive", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const deadPid = 999_999_999; // exceedingly unlikely to be a live pid
    const manifestPath = join(spoolDir, "dead-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: deadPid,
        command: "echo",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.completedAt).toBeDefined();
    expect(updated.exitCode).toBe(-1);
    expect(updated.crashed).toBe(true);
  });

  it("logs a warning and continues when a manifest file contains malformed JSON", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphan, then finalizes it once its pid is detected as dead", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const processId = "live-proc";
    const logPath = join(spoolDir, `${processId}.log`);
    const manifestPath = join(spoolDir, `${processId}.json`);
    writeFileSync(logPath, "existing log content\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 424242,
        command: "claude",
        args: [],
        runId: "run-live",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let killCalls = 0;
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
      killCalls += 1;
      if (killCalls === 1) {
        // Aliveness check inside rehydrateOrphans succeeds.
        return true;
      }
      // Every subsequent check (from the poll interval) reports the process as dead.
      throw new Error("ESRCH");
    }) as never);

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-live",
      processId,
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput(processId)).toBe("existing log content\n");

    // Advance past the 5s poll interval so the dead-pid check fires.
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-live",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(-1);

    vi.useRealTimers();
  });
});
