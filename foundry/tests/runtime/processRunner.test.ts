import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { spawn } from "node:child_process";
const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

class FakeChildProcess extends EventEmitter {
  pid: number | undefined;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn((_signal?: string) => {
    return true;
  });

  constructor(pid = 4321) {
    super();
    this.pid = pid;
  }
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

// A single shared root, cleaned up once at the very end of the suite (rather
// than per-test) — ProcessRunner's write streams open the per-process log
// file asynchronously with no error handler attached, so removing a test's
// spool directory too eagerly (immediately in afterEach) can race a
// still-pending open() and blow up as an unhandled 'error' event.
let rootDir: string;
let spoolDir: string;

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), "processrunner-test-root-"));
});

afterAll(async () => {
  // Give any straggling async fs opens from the final tests time to settle
  // before the directory tree disappears out from under them.
  await new Promise((r) => setTimeout(r, 100));
  try {
    rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

beforeEach(() => {
  spoolDir = mkdtempSync(join(rootDir, "case-"));
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "some-cli",
    args: ["--flag"],
    cwd: "/tmp",
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("ProcessRunner — constructor", () => {
  it("creates the spool directory (including nested paths) eagerly", () => {
    const nested = join(spoolDir, "deep", "nested", "dir");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("mock", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handlerResult = {
      stdout: "mocked out",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const options = baseOptions({ command: "mock-cmd", args: ["a", "b"], cwd: "/wd" });
    const result = await runner.execute(options);

    expect(result).toBe(handlerResult);
    expect(handler).toHaveBeenCalledWith(options);
    expect(logger.debug).toHaveBeenCalledWith(
      { command: "mock-cmd", args: ["a", "b"], cwd: "/wd" },
      "Executing mock process",
    );
  });

  it("propagates a rejection from the mock handler", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    runner.setMockHandler(vi.fn().mockRejectedValue(new Error("handler exploded")));
    await expect(runner.execute(baseOptions())).rejects.toThrow("handler exploded");
  });

  it("never touches active-process tracking or the spool directory", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    runner.setMockHandler(
      vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false }),
    );
    await runner.execute(
      baseOptions({ context: { runId: "r1", stage: "planner", runtime: "claude-code" } }),
    );
    expect(runner.getActiveProcesses()).toEqual([]);
  });
});

describe("ProcessRunner — real mode: happy path output capture", () => {
  it("captures and concatenates stdout/stderr across multiple chunks, resolving on close", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());

    fake.stdout.emit("data", Buffer.from("hello "));
    fake.stdout.emit("data", Buffer.from("world"));
    fake.stderr.emit("data", Buffer.from("warn1"));
    fake.stderr.emit("data", Buffer.from("warn2"));
    fake.emit("close", 0);

    const result = await promise;

    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn1warn2");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", exitCode: 0 }),
      "Process completed",
    );
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    fake.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("resolves (does not reject) on a non-zero exit code absent a timeout", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    fake.stderr.emit("data", Buffer.from("boom"));
    fake.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("boom");
  });

  it("merges extra env vars on top of process.env when spawning", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ env: { CUSTOM_VAR: "1" } }));
    fake.emit("close", 0);
    await promise;

    const spawnCall = spawnMock.mock.calls[0]!;
    expect(spawnCall[0]).toBe("some-cli");
    expect(spawnCall[2].env).toMatchObject({ ...process.env, CUSTOM_VAR: "1" });
    expect(spawnCall[2].stdio).toEqual(["pipe", "pipe", "pipe"]);
  });
});

describe("ProcessRunner — real mode: stdin handling", () => {
  it("writes stdinData and ends stdin when stdinData is provided", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "hello stdin" }));
    fake.emit("close", 0);
    await promise;

    expect(fake.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(fake.stdin.end).toHaveBeenCalledOnce();
  });

  it("only ends stdin (no write) when stdinData is absent", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    fake.emit("close", 0);
    await promise;

    expect(fake.stdin.write).not.toHaveBeenCalled();
    expect(fake.stdin.end).toHaveBeenCalledOnce();
  });
});

describe("ProcessRunner — real mode: spawn error", () => {
  it("rejects with the spawn error and still runs cleanup when context is present", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "planner", runtime: "claude-code" } }),
    );

    const err = new Error("spawn ENOENT");
    fake.emit("error", err);

    await expect(promise).rejects.toThrow("spawn ENOENT");
    // cleanupProcess should have removed the (short-lived) active entry and
    // reported exitCode -1 via the completion event.
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("rejects with the spawn error when no context/process tracking is involved", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    fake.emit("error", new Error("EACCES"));

    await expect(promise).rejects.toThrow("EACCES");
  });
});

describe("ProcessRunner — real mode: timeout behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM at timeoutMs, then SIGKILL 5s later if the process is still not killed, and rejects with AgentTimeoutError", async () => {
    const fake = new FakeChildProcess();
    // kill() does not flip `killed` — simulates a process that ignores SIGTERM.
    spawnMock.mockReturnValue(fake);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ command: "stubborn-cli", timeoutMs: 1_000 }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fake.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.kill).toHaveBeenCalledTimes(2);

    fake.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    await expect(promise).rejects.toThrow(/stubborn-cli/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "stubborn-cli", timeoutMs: 1_000 }),
      "Process timed out",
    );
  });

  it("skips the SIGKILL follow-up once the child reports killed=true after SIGTERM", async () => {
    const fake = new FakeChildProcess();
    fake.kill.mockImplementation(() => {
      fake.killed = true;
      return true;
    });
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 500 }));

    await vi.advanceTimersByTimeAsync(500);
    expect(fake.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    // Still just the one SIGTERM call -- no follow-up SIGKILL was sent.
    expect(fake.kill).toHaveBeenCalledTimes(1);

    fake.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("uses the '<runtime>/<stage>' label in the timeout error when context is present", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 200,
        context: { runId: "run-9", stage: "executor", runtime: "claude-code" },
      }),
    );

    await vi.advanceTimersByTimeAsync(200);
    fake.emit("close", null);

    await expect(promise).rejects.toThrow(/claude-code\/executor" timed out after 200ms/);
    // cleanup still ran and reported the completion (with the fallback exit code 1,
    // since `code ?? 1` is evaluated before the timeout check).
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      expect.any(String),
      "executor",
      "claude-code",
      1,
      expect.any(Number),
    );
  });

  it("does not resolve/reject before the timeout fires if the process is simply slow", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    let settled = false;
    const promise = runner.execute(baseOptions({ timeoutMs: 5_000 }));
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    fake.emit("close", 0);
    await promise;
    expect(settled).toBe(true);
  });
});

describe("ProcessRunner — real mode: process tracking, manifests, and cleanup", () => {
  it("tracks an active process, writes its manifest, emits start/completion events, and cleans up on close", async () => {
    const fake = new FakeChildProcess(9876);
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({
        command: "tracked-cli",
        args: ["run"],
        context: { runId: "run-42", stage: "planner", runtime: "claude-code" },
      }),
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    const [entry] = active;
    expect(entry).toMatchObject({
      pid: 9876,
      command: "tracked-cli",
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof entry!.id).toBe("string");
    expect(entry!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      entry!.id,
      "planner",
      "claude-code",
      "tracked-cli",
    );

    const manifestPath = join(spoolDir, `${entry!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore).toMatchObject({
      id: entry!.id,
      pid: 9876,
      command: "tracked-cli",
      args: ["run"],
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(manifestBefore.completedAt).toBeUndefined();

    fake.stdout.emit("data", Buffer.from("output"));
    fake.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toEqual([]);
    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.completedAt).toEqual(expect.any(String));
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.durationMs).toBe("number");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      entry!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: entry!.id, exitCode: 0, runId: "run-42" }),
      "Agent process completed",
    );
  });

  it("does not create a tracked entry when the spawned child has no pid", async () => {
    const fake = new FakeChildProcess();
    fake.pid = undefined;
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-x", stage: "planner", runtime: "claude-code" } }),
    );
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    fake.emit("close", 0);
    await promise;
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not create a tracked entry when no context is supplied", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toEqual([]);

    fake.emit("close", 0);
    await promise;
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — output buffering and throttled emission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
  });

  it("throttles emitProcessOutput to once per 250ms window and slices long chunks to their last 500 chars", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-throttle", stage: "planner", runtime: "claude-code" } }),
    );
    const [entry] = runner.getActiveProcesses();

    const longChunk = "A".repeat(600);
    fake.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-throttle",
      entry!.id,
      longChunk.slice(-500),
    );

    // Second chunk arrives within the same 250ms window -> suppressed.
    fake.stdout.emit("data", Buffer.from("B".repeat(20)));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window; next chunk should emit again, unsliced
    // since it's under 500 chars.
    vi.advanceTimersByTime(300);
    fake.stdout.emit("data", Buffer.from("C"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith("run-throttle", entry!.id, "C");

    fake.emit("close", 0);
    await promise;
  });

  it("trims the in-memory rolling buffer to ROLLING_BUFFER_MAX (8KB) bytes", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-big", stage: "planner", runtime: "claude-code" } }),
    );
    const [entry] = runner.getActiveProcesses();

    const big = "X".repeat(9_000);
    fake.stdout.emit("data", Buffer.from(big));

    const buffered = runner.getProcessOutput(entry!.id);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBe(8 * 1024);
    expect(buffered).toBe(big.slice(-8 * 1024));

    fake.emit("close", 0);
    await promise;
  });

  it("does not attempt to emit output when no emitter is configured", async () => {
    const fake = new FakeChildProcess();
    spawnMock.mockReturnValue(fake);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-noemit", stage: "planner", runtime: "claude-code" } }),
    );
    const [entry] = runner.getActiveProcesses();

    expect(() => fake.stdout.emit("data", Buffer.from("hi"))).not.toThrow();
    expect(runner.getProcessOutput(entry!.id)).toBe("hi");

    fake.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null for an unknown process id with no matching log file", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads the tail of an on-disk log file for a completed/unknown-in-memory process, capped at 8KB", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const content = "line\n".repeat(3000); // > 8KB
    writeFileSync(join(spoolDir, "proc-1.log"), content);

    const output = runner.getProcessOutput("proc-1");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toBe(content.slice(-8 * 1024));
  });

  it("returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    // Force existsSync -> true but readFileSync -> throws (EISDIR) by making
    // the "log file" a directory instead of a file.
    mkdirSync(join(spoolDir, "proc-2.log"));

    expect(runner.getProcessOutput("proc-2")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently (no throw) when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores non-.json files in the spool directory", () => {
    writeFileSync(join(spoolDir, "readme.txt"), "not json");
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("skips manifests that are already marked completed", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 111,
        command: "x",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a manifest whose process is no longer alive as crashed and rewrites it", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeMockLogger();
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 424242,
        command: "ghost-cli",
        args: [],
        runId: "r-dead",
        stage: "reviewer",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead.log"),
      }),
    );

    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: 424242, stage: "reviewer" }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(runner.getActiveProcesses()).toEqual([]);

    const rewritten = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(rewritten.crashed).toBe(true);
    expect(rewritten.exitCode).toBe(-1);
    expect(rewritten.completedAt).toEqual(expect.any(String));
  });

  it("logs a warning (without throwing) for a manifest file containing invalid JSON", () => {
    const logger = makeMockLogger();
    writeFileSync(join(spoolDir, "corrupt.json"), "{ not valid json");

    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphan into activeProcesses, then finalizes it once the process later disappears", async () => {
    vi.useFakeTimers();

    let killCalls = 0;
    vi.spyOn(process, "kill").mockImplementation(() => {
      killCalls += 1;
      if (killCalls === 1) return true as never; // initial "is it alive?" check in rehydrateOrphans
      throw new Error("ESRCH"); // subsequent poll from tailLogForOrphan's setInterval
    });

    const logPath = join(spoolDir, "live.log");
    writeFileSync(logPath, "pre-existing log content\n");

    const manifestPath = join(spoolDir, "live.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "live",
        pid: 555555,
        command: "long-running-cli",
        args: ["go"],
        runId: "run-live",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live", pid: 555555, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-live",
      "live",
      "executor",
      "claude-code",
      "long-running-cli",
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "live", pid: 555555, runId: "run-live" });
    expect(runner.getProcessOutput("live")).toBe("pre-existing log content\n");

    // Advance past the 5s poll interval inside tailLogForOrphan; process.kill
    // now throws, so the orphan should be finalized.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-live",
      "live",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { processId: "live", pid: 555555 },
      "Orphaned process has exited",
    );

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toEqual(expect.any(String));
    expect(finalManifest.exitCode).toBe(-1);
  });
});
