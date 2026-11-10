import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Capture every call to fs.watch so tests can drive its callback deterministically
// instead of depending on real OS file-watch timing (which would be slow/flaky).
const watchMock = vi.fn();
// Track every real WriteStream the code under test opens against the temp spool
// dir, so afterEach can make sure each one is fully closed/destroyed before the
// directory is removed (otherwise a pending async fd-open can throw an ENOENT
// write error after the directory is gone).
const createdWriteStreams: import("node:fs").WriteStream[] = [];
// When set, a readFileSync() call for exactly this path throws a plain (non-Error)
// value, to exercise the `err instanceof Error ? ... : String(err)` fallback that
// real fs errors never take (they are always genuine Error instances).
let forceNonErrorThrowPath: string | null = null;
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: actual,
    watch: (...args: unknown[]) => watchMock(...args),
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      const stream = actual.createWriteStream(...args);
      createdWriteStreams.push(stream);
      return stream;
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (forceNonErrorThrowPath && args[0] === forceNonErrorThrowPath) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "not an Error instance";
      }
      return actual.readFileSync(...args);
    },
  };
});

// Replace child_process.spawn with a controllable fake so we never touch real
// subprocesses, matching the fully-deterministic style used elsewhere for this
// process-spawning/lifecycle manager.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

class FakeChild extends EventEmitter {
  pid = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "some-cli",
    args: ["--flag"],
    cwd: "/tmp",
    timeoutMs: 60_000,
    ...overrides,
  };
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  spawnMock.mockReset();
  watchMock.mockReset();
  watchMock.mockImplementation(() => ({ close: vi.fn() }));
  forceNonErrorThrowPath = null;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();

  // Real WriteStreams opened against spoolDir during the test may still be
  // mid-flight (async fd open/write). Force every tracked stream closed —
  // ending the ones the code under test already called .end() on, and
  // destroying any still-open one (e.g. a rehydrated orphan left "alive" at
  // the end of a test) — before removing the directory out from under them.
  await Promise.all(
    createdWriteStreams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.destroyed) {
            resolve();
            return;
          }
          stream.once("close", () => resolve());
          stream.once("error", () => resolve());
          if (!stream.writableEnded) {
            stream.destroy();
          }
        }),
    ),
  );
  createdWriteStreams.length = 0;

  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // already removed by a test
  }
});

describe("ProcessRunner — constructor defaults", () => {
  it("defaults the spool directory to .foundry/processes when none is given", () => {
    const defaultDir = resolve(".foundry/processes");
    expect(existsSync(defaultDir)).toBe(false);

    try {
      // eslint-disable-next-line no-new
      new ProcessRunner("mock", makeLogger() as never);
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      rmSync(resolve(".foundry"), { recursive: true, force: true });
    }
  });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when mock mode is enabled but no mock handler was configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    const handlerResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const options = baseOptions();
    const result = await runner.execute(options);

    expect(result).toBe(handlerResult);
    expect(handler).toHaveBeenCalledWith(options);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — executeReal success/failure paths", () => {
  it("resolves with captured stdout/stderr and exitCode 0 on a clean run", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("a warning"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("a warning");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves (does not reject) with a non-zero exit code", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 5);

    const result = await promise;
    expect(result.exitCode).toBe(5);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when close is called with a null code", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData and ends stdin when provided", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "payload" }));
    expect(child.stdin.write).toHaveBeenCalledWith("payload");
    expect(child.stdin.end).toHaveBeenCalledOnce();

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledOnce();

    child.emit("close", 0);
    await promise;
  });

  it("rejects when spawn emits an 'error' event (e.g. ENOENT)", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    const err = new Error("spawn some-cli ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("merges extraEnv into process.env when spawning", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ env: { MY_VAR: "1" } }));
    const spawnCallArgs = spawnMock.mock.calls[0]!;
    const spawnOpts = spawnCallArgs[2] as { env: Record<string, string> };
    expect(spawnOpts.env.MY_VAR).toBe("1");
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — timeout and kill behavior", () => {
  it("kills with SIGTERM on timeout and rejects with AgentTimeoutError once the process closes", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.killed).toBe(true);

    child.emit("close", null);
    await assertion;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", timeoutMs: 1_000 }),
      "Process timed out",
    );

    // Because the process already honored SIGTERM (child.killed === true), the
    // deferred SIGKILL fallback must not fire a second kill.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("escalates to SIGKILL after 5s when the process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    // Simulate a process that ignores SIGTERM: kill() never flips `killed`.
    child.kill = vi.fn().mockReturnValue(true);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await assertion;
  });

  it("uses the runtime/stage label (not the raw command) in the timeout error when context is present", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 500,
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
      }),
    );
    const assertion = promise.catch((e) => e as AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    const err = await assertion;
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect((err as AgentTimeoutError).agent).toBe("claude-code/planner");
  });
});

describe("ProcessRunner — active process tracking (context provided)", () => {
  it("tracks an active process, emits lifecycle events, and writes/updates a manifest file", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({
        command: "claude",
        args: ["--print"],
        context: { runId: "run-42", stage: "executor", runtime: "claude-code" },
      }),
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    const procId = active[0]!.id;
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "claude",
      runId: "run-42",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.startedAt).toBe("string");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      procId,
      "executor",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${procId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore).toMatchObject({
      id: procId,
      pid: child.pid,
      command: "claude",
      args: ["--print"],
      runId: "run-42",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(manifestBefore.completedAt).toBeUndefined();

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(procId)).toBe("partial output");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      procId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.completedAt).toBe("string");
    expect(typeof manifestAfter.durationMs).toBe("number");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: procId, exitCode: 0, runId: "run-42" }),
      "Agent process completed",
    );
  });

  it("does not track, emit, or write a manifest when no context is given", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("updates the manifest with exitCode -1 and cleans up the active entry when spawn errors", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }),
    );
    const procId = runner.getActiveProcesses()[0]!.id;

    const err = new Error("boom");
    child.emit("error", err);
    await expect(promise).rejects.toBe(err);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    const manifest = JSON.parse(readFileSync(join(spoolDir, `${procId}.json`), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r1",
      procId,
      "planner",
      "codex",
      -1,
      expect.any(Number),
    );
  });

  it("ignores a second close event for the same process (cleanupProcess guards on missing entry)", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }),
    );
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    // A stray duplicate close event must be a no-op, not a crash or a duplicate emit.
    expect(() => child.emit("close", 0)).not.toThrow();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
  });

  it("still completes and emits process:completed when the manifest file is gone by the time cleanup runs", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }),
    );
    const procId = runner.getActiveProcesses()[0]!.id;
    // Remove the manifest before the process closes so cleanupProcess's
    // best-effort manifest re-read/update throws and is swallowed.
    rmSync(join(spoolDir, `${procId}.json`), { force: true });

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r1",
      procId,
      "planner",
      "codex",
      0,
      expect.any(Number),
    );
    expect(existsSync(join(spoolDir, `${procId}.json`))).toBe(false);
  });

  it("truncates the rolling output buffer to the last 8KB", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }),
    );
    const procId = runner.getActiveProcesses()[0]!.id;

    child.stdout.emit("data", Buffer.from("a".repeat(5000)));
    child.stdout.emit("data", Buffer.from("b".repeat(5000)));
    const output = runner.getProcessOutput(procId);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output!.endsWith("b")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles emitProcessOutput calls to once per 250ms, flushing again once the window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.execute(baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }));

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_300);
    child.stdout.emit("data", Buffer.from("third"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
  });

  it("truncates an emitted chunk to its last 500 characters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.execute(baseOptions({ context: { runId: "r1", stage: "planner", runtime: "codex" } }));

    const longChunk = "x".repeat(600) + "[END]";
    child.stdout.emit("data", Buffer.from(longChunk));

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((emittedChunk as string).length).toBe(500);
    expect((emittedChunk as string).endsWith("[END]")).toBe(true);

    child.emit("close", 0);
  });
});

describe("ProcessRunner.getProcessOutput — non-active lookups", () => {
  it("returns null when there is no active entry and no log file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads and tail-truncates the on-disk log file when there is no active entry", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const content = "y".repeat(9000) + "[TAIL]";
    writeFileSync(join(spoolDir, "proc-a.log"), content);

    const output = runner.getProcessOutput("proc-a");
    expect(output).toBe(content.slice(-8 * 1024));
  });

  it("returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // A directory at the expected log path makes readFileSync throw (EISDIR).
    mkdirSync(join(spoolDir, "proc-b.log"));

    expect(runner.getProcessOutput("proc-b")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be read", () => {
    rmSync(spoolDir, { recursive: true, force: true });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // Constructor re-creates the dir; remove it again to force readdirSync to throw.
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 99999,
        command: "x",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("marks an orphan crashed when its pid is no longer alive", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 123456,
        command: "claude",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: 123456 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(typeof manifest.completedAt).toBe("string");
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("stringifies a non-Error value thrown while processing a manifest", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "weird.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "weird",
        pid: 111,
        command: "claude",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "weird.log"),
      }),
    );
    forceNonErrorThrowPath = manifestPath;

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "weird.json", error: "not an Error instance" }),
      "Failed to process manifest",
    );

    killSpy.mockRestore();
  });

  it("safely no-ops when re-rehydrating the same still-pending manifest leaves a stale poll interval racing against a newer one", async () => {
    // This mirrors a crash-looping orchestrator calling rehydrateOrphans() more
    // than once for a manifest that was never marked completed: the second call
    // replaces the tracked entry, so the FIRST poll interval's pid lookup comes
    // back empty (exercising the `?? 0` fallback) and, once it finalizes the
    // (now-shared) processId, the SECOND interval's own finalize attempt finds
    // nothing left to finalize (the early-return guard) — without crashing or
    // double-emitting completion.
    vi.useFakeTimers();
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "racey.log");
    writeFileSync(logPath, "");
    writeFileSync(
      join(spoolDir, "racey.json"),
      JSON.stringify({
        id: "racey",
        pid: 222,
        command: "claude",
        args: [],
        runId: "run-racey",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    alive = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-racey",
      "racey",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{ this is not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
    killSpy.mockRestore();
  });

  it("rehydrates a live orphan, tails its log, and finalizes it once the pid disappears", async () => {
    vi.useFakeTimers();
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });

    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "live.log");
    writeFileSync(logPath, "existing log content");
    writeFileSync(
      join(spoolDir, "live.json"),
      JSON.stringify({
        id: "live",
        pid: 777,
        command: "claude",
        args: ["--print"],
        runId: "run-live",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live", pid: 777, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-live",
      "live",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("live")).toBe("existing log content");
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));

    const watchCallback = watchMock.mock.calls[watchMock.mock.calls.length - 1]![1] as () => void;
    const fakeWatcher = watchMock.mock.results[watchMock.mock.results.length - 1]!.value as {
      close: ReturnType<typeof vi.fn>;
    };

    // Simulate the log file growing: the watch callback should pick up the delta.
    writeFileSync(logPath, "existing log contentMORE");
    watchCallback();
    expect(runner.getProcessOutput("live")).toBe("existing log contentMORE");

    // The pid dies; the 5s poll interval should detect it and finalize the orphan.
    alive = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-live",
      "live",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live", pid: 777 }),
      "Orphaned process has exited",
    );
    const manifest = JSON.parse(readFileSync(join(spoolDir, "live.json"), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(typeof manifest.completedAt).toBe("string");

    // A stray watch event after finalization must be a safe no-op that closes
    // the (already-closed) watcher again rather than throwing.
    expect(() => watchCallback()).not.toThrow();

    killSpy.mockRestore();
  });

  it("rehydrates a live orphan that has no log file yet, and still tails new content once one appears", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "no-log-yet.log");
    // Deliberately do NOT create the log file before rehydrating — both the
    // rehydrate-time read and tailLogForOrphan's initial size read must
    // tolerate a missing file.
    writeFileSync(
      join(spoolDir, "no-log-yet.json"),
      JSON.stringify({
        id: "no-log-yet",
        pid: 555,
        command: "claude",
        args: [],
        runId: "run-nolog",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("no-log-yet")).toBe("");

    const watchCallback = watchMock.mock.calls[watchMock.mock.calls.length - 1]![1] as () => void;
    writeFileSync(logPath, "now it exists");
    watchCallback();
    expect(runner.getProcessOutput("no-log-yet")).toBe("now it exists");

    killSpy.mockRestore();
  });

  it("ignores a read error inside the watch callback (e.g. the log file disappears mid-tail)", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const logPath = join(spoolDir, "vanishing.log");
    writeFileSync(logPath, "initial");
    writeFileSync(
      join(spoolDir, "vanishing.json"),
      JSON.stringify({
        id: "vanishing",
        pid: 556,
        command: "claude",
        args: [],
        runId: "run-vanish",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    const watchCallback = watchMock.mock.calls[watchMock.mock.calls.length - 1]![1] as () => void;

    rmSync(logPath, { force: true });
    expect(() => watchCallback()).not.toThrow();
    // Buffer stays as it was before the failed read.
    expect(runner.getProcessOutput("vanishing")).toBe("initial");

    killSpy.mockRestore();
  });

  it("swallows a manifest read/write error when finalizing an orphan whose manifest file is gone", async () => {
    vi.useFakeTimers();
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "no-manifest.log");
    const manifestPath = join(spoolDir, "no-manifest.json");
    writeFileSync(logPath, "");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "no-manifest",
        pid: 557,
        command: "claude",
        args: [],
        runId: "run-nomanifest",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    rmSync(manifestPath, { force: true });
    alive = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-nomanifest",
      "no-manifest",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(existsSync(manifestPath)).toBe(false);

    killSpy.mockRestore();
  });

  it("keeps a live orphan tracked across poll ticks while the pid remains alive", async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const logPath = join(spoolDir, "still-alive.log");
    writeFileSync(logPath, "");
    writeFileSync(
      join(spoolDir, "still-alive.json"),
      JSON.stringify({
        id: "still-alive",
        pid: 888,
        command: "codex",
        args: [],
        runId: "run-x",
        stage: "plan-reviewer",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);

    // Still alive: the entry must remain tracked, not finalized.
    expect(runner.getActiveProcesses()).toHaveLength(1);

    killSpy.mockRestore();
  });
});
