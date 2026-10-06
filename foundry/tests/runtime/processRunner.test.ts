import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessContext } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let spawnMock: any;

interface FakeChild extends EventEmitter {
  pid: number;
  killed: boolean;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.pid = pid;
  child.killed = false;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 10_000,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ProcessContext> = {}): ProcessContext {
  return { runId: "run-1", stage: "executor", runtime: "claude-code", ...overrides };
}

let spoolDir: string;

beforeEach(async () => {
  const { spawn } = await import("node:child_process");
  spawnMock = spawn;
  spawnMock.mockReset();
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
});

afterEach(() => {
  vi.useRealTimers();
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("ProcessRunner constructor", () => {
  it("creates the spool directory eagerly", () => {
    const freshDir = join(spoolDir, "nested", "dir");
    expect(existsSync(freshDir)).toBe(false);
    new ProcessRunner("real", makeMockLogger() as never, undefined, freshDir);
    expect(existsSync(freshDir)).toBe(true);
  });
});

describe("ProcessRunner.execute() — mock mode", () => {
  it("throws when mock mode is enabled but no handler was configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result verbatim", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked stdout",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions({ command: "mock-cmd" }));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: "mock-cmd" }));
    expect(result.stdout).toBe("mocked stdout");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "mock-cmd" }),
      "Executing mock process",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute() — real mode, normal completion", () => {
  it("resolves with concatenated stdout/stderr and exitCode 0 on a clean exit", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: something"));
    child.emit("close", 0);

    const result = await resultPromise;

    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn: something",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("passes command/args/cwd and a merged environment to spawn", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(
      baseOptions({ command: "mytool", args: ["--flag"], cwd: "/work", env: { MY_VAR: "abc" } }),
    );
    child.emit("close", 0);
    await resultPromise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, spawnOpts] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe("mytool");
    expect(args).toEqual(["--flag"]);
    expect(spawnOpts.cwd).toBe("/work");
    expect(spawnOpts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(spawnOpts.env.MY_VAR).toBe("abc");
    // process.env is preserved alongside the extra vars
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);
  });

  it("resolves with a non-zero exitCode instead of rejecting", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 127);

    const result = await resultPromise;
    expect(result.exitCode).toBe(127);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("boom");
  });

  it("treats a null close code as exit code 1", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
  });

  it("resolves with empty stdout/stderr when the process produces no output", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("handles malformed/binary stdout chunks without throwing, preserving UTF-8 decoding", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    // Bytes that are not valid standalone UTF-8 (lone continuation byte) — Buffer#toString
    // substitutes U+FFFD rather than throwing.
    child.stdout.emit("data", Buffer.from([0xff, 0xfe, 0x41]));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.stdout).toContain("A");
    expect(result.exitCode).toBe(0);
  });

  it("writes stdinData to the child and ends stdin", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions({ stdinData: "the prompt text" }));
    child.emit("close", 0);
    await resultPromise;

    expect(child.stdin.write).toHaveBeenCalledWith("the prompt text");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    child.emit("close", 0);
    await resultPromise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("rejects with the spawn error when the child process errors out, without logging completion", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    const spawnError = new Error("ENOENT: spawn echo failed");
    child.emit("error", spawnError);

    await expect(resultPromise).rejects.toThrow("ENOENT: spawn echo failed");
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Process completed",
    );
  });
});

describe("ProcessRunner.execute() — timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM when the timeout elapses and rejects with AgentTimeoutError once the process closes", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const resultPromise = runner.execute(
      baseOptions({ timeoutMs: 1000, context: makeContext({ stage: "executor", runtime: "codex" }) }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.killed = true;
    child.emit("close", null);

    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
    await expect(resultPromise).rejects.toThrow(/codex\/executor/);
    await expect(resultPromise).rejects.toMatchObject({ timeoutMs: 1000 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL if the process has not died 5s after SIGTERM", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    runner.execute(baseOptions({ timeoutMs: 1000 })).catch(() => {
      // never resolves/rejects in this test — the child never emits "close"
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    // child never actually dies (child.killed stays false)
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("does not escalate to SIGKILL if the child's `killed` flag is already true", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    runner.execute(baseOptions({ timeoutMs: 1000 })).catch(() => {
      // intentionally left unresolved for this assertion
    });

    await vi.advanceTimersByTimeAsync(1000);
    child.killed = true; // simulate the SIGTERM having worked

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("labels the timeout error with the raw command when no context is supplied", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions({ command: "no-context-cmd", timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    await expect(resultPromise).rejects.toThrow(/no-context-cmd/);
  });
});

describe("ProcessRunner — active process tracking and output (context provided)", () => {
  it("tracks an active process, buffers its output, writes a manifest, and cleans up on close", async () => {
    const child = createFakeChild(5555);
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context = makeContext({ runId: "run-42", stage: "executor", runtime: "claude-code" });

    const resultPromise = runner.execute(baseOptions({ context }));

    // Registration happens synchronously before the promise settles.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    const processId = active[0]!.id;
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "echo",
      runId: "run-42",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "executor",
      "claude-code",
      "echo",
    );

    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore).toMatchObject({ id: processId, pid: 5555, runId: "run-42" });
    expect(manifestBefore.completedAt).toBeUndefined();

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(processId)).toBe("partial output");
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-42",
      processId,
      "partial output",
    );

    child.emit("close", 0);
    await resultPromise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.completedAt).toBe("string");
    expect(typeof manifestAfter.durationMs).toBe("number");

    // Log file was written with the streamed chunk.
    const logPath = join(spoolDir, `${processId}.log`);
    expect(readFileSync(logPath, "utf-8")).toBe("partial output");
  });

  it("caps the rolling buffer at 8KB, keeping only the most recent bytes", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      undefined,
      spoolDir,
    );
    const context = makeContext();

    runner.execute(baseOptions({ context }));
    const processId = runner.getActiveProcesses()[0]!.id;

    const big = "a".repeat(5000);
    child.stdout.emit("data", Buffer.from(big));
    child.stdout.emit("data", Buffer.from(big));
    const buffered = runner.getProcessOutput(processId);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBe(8 * 1024);
    expect(buffered!.endsWith("a")).toBe(true);

    child.emit("close", 0);
  });

  it("does not register an active process or write a manifest when no context is given", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const resultPromise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await resultPromise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("calls emitProcessCompleted with exitCode -1 and leaves the manifest intact on a spawn error", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const context = makeContext();

    const resultPromise = runner.execute(baseOptions({ context }));
    const processId = runner.getActiveProcesses()[0]!.id;

    child.emit("error", new Error("spawn failure"));
    await expect(resultPromise).rejects.toThrow("spawn failure");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      context.runId,
      processId,
      context.stage,
      context.runtime,
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe("ProcessRunner.getProcessOutput() — standalone", () => {
  it("returns null when neither an active entry nor a log file exists", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("reads and tail-trims the log file from disk when there is no active entry", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const id = "cold-process-id";
    const content = "x".repeat(9000) + "[TAIL]";
    writeFileSync(join(spoolDir, `${id}.log`), content);

    const output = runner.getProcessOutput(id);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output!.endsWith("[TAIL]")).toBe(true);
  });

  it("returns null (swallowing the error) when the log path cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const id = "unreadable-id";
    // Make the ".log" path a directory instead of a file so readFileSync throws.
    mkdirSync(join(spoolDir, `${id}.log`));

    expect(runner.getProcessOutput(id)).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("does nothing when the spool directory has no manifest files", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("marks a manifest for a dead pid as crashed and writes back exitCode -1", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const manifest = {
      id: "orphan-dead",
      pid: 999_999_999, // guaranteed not to exist
      command: "echo",
      args: ["hi"],
      runId: "run-dead",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "orphan-dead.log"),
    };
    writeFileSync(join(spoolDir, "orphan-dead.json"), JSON.stringify(manifest));

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-dead.json"), "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(typeof updated.completedAt).toBe("string");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-dead", pid: 999_999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
  });

  it("skips a manifest that already has completedAt set", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifest = {
      id: "already-done",
      pid: process.pid,
      command: "echo",
      args: [],
      runId: "run-done",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "already-done.log"),
      completedAt: new Date().toISOString(),
      exitCode: 0,
    };
    writeFileSync(join(spoolDir, "already-done.json"), JSON.stringify(manifest));

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("logs a warning and continues when a manifest file contains malformed JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphan into activeProcesses and later finalizes it once it's detected as dead", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logFile = join(spoolDir, "orphan-alive.log");
    writeFileSync(logFile, "existing log content");

    const manifest = {
      id: "orphan-alive",
      pid: process.pid,
      command: "claude",
      args: ["--print"],
      runId: "run-alive",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile,
    };
    writeFileSync(join(spoolDir, "orphan-alive.json"), JSON.stringify(manifest));

    let killCallCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: unknown) => {
      killCallCount += 1;
      if (killCallCount > 1) {
        throw new Error("ESRCH");
      }
      return true as never;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    try {
      runner.rehydrateOrphans();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "orphan-alive", runId: "run-alive", pid: process.pid });
      expect(runner.getProcessOutput("orphan-alive")).toBe("existing log content");

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "orphan-alive",
        "executor",
        "claude-code",
        "claude",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-alive", pid: process.pid }),
        "Rehydrating orphaned agent process",
      );

      // Advance past the 5s liveness-poll interval; process.kill is mocked to throw
      // on this tick, simulating the orphan having exited.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "orphan-alive",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-alive", pid: process.pid }),
        "Orphaned process has exited",
      );

      const finalManifest = JSON.parse(readFileSync(join(spoolDir, "orphan-alive.json"), "utf-8"));
      expect(finalManifest.exitCode).toBe(-1);
      expect(typeof finalManifest.completedAt).toBe("string");
    } finally {
      killSpy.mockRestore();
    }
  });
});
