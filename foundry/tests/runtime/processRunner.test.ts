import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessResult } from "../../src/runtime/runnerTypes.js";

// Mock the child_process module so executeReal() never spawns a real OS process.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Partially mock node:fs: keep every real function (mkdirSync, readFileSync, etc.
// operate on a real temp directory) but replace `watch` with a controllable fake
// so tailLogForOrphan()'s callback can be triggered deterministically instead of
// depending on real, timing-sensitive OS filesystem events.
const watchCallbacks = new Map<string, (eventType: string, filename: string | null) => void>();
const watchCloseMocks = new Map<string, ReturnType<typeof vi.fn>>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn((path: string, cb: (eventType: string, filename: string | null) => void) => {
      watchCallbacks.set(path, cb);
      const close = vi.fn();
      watchCloseMocks.set(path, close);
      return { close };
    }),
  };
});

// Imported AFTER the mocks above so ProcessRunner picks up the mocked modules.
const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeFakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.killed = false;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((_signal?: string) => {
    child.killed = true;
    return true;
  });
  return child;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  vi.mocked(spawn).mockReset();
  watchCallbacks.clear();
  watchCloseMocks.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  // createWriteStream()'s underlying fs.open() is asynchronous; give any
  // pending opens a chance to settle (on real timers) before the spool
  // directory is removed, so a late open doesn't throw an unhandled ENOENT
  // against a now-deleted path.
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("ProcessRunner — constructor", () => {
  it("defaults the spool directory to .foundry/processes (relative to cwd) when none is given", () => {
    const defaultDir = join(process.cwd(), ".foundry", "processes");
    const existedBefore = existsSync(defaultDir);
    try {
      const runner = new ProcessRunner("mock", makeLogger() as never);
      expect(runner).toBeInstanceOf(ProcessRunner);
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      // .foundry/ is a gitignored scratch directory; only remove it if this
      // test is the one that created it, to avoid clobbering anything real.
      if (!existedBefore) {
        rmSync(join(process.cwd(), ".foundry"), { recursive: true, force: true });
      }
    }
  });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when execute() is called without a mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow(/Mock mode enabled but no mock handler configured/);
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    const fakeResult: ProcessResult = {
      stdout: "mocked stdout",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(fakeResult);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(result).toBe(fakeResult);
    expect(handler).toHaveBeenCalledWith(options);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — getActiveProcesses() / getProcessOutput() baseline", () => {
  it("getActiveProcesses() returns an empty array when nothing is running", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("getProcessOutput() returns null when the process is neither active nor logged to disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("getProcessOutput() reads the tail of a completed process's log file from disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "logged-proc.log"), "line one\nline two\n");

    expect(runner.getProcessOutput("logged-proc")).toBe("line one\nline two\n");
  });

  it("getProcessOutput() returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // Create a directory where the log file is expected, so existsSync() is
    // true but readFileSync() throws (EISDIR), exercising the catch branch.
    mkdirSync(join(spoolDir, "dir-proc.log"));

    expect(runner.getProcessOutput("dir-proc")).toBeNull();
  });
});

describe("ProcessRunner — executeReal() happy path", () => {
  it("spawns the command, collects stdout/stderr, and resolves with exitCode 0", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 60_000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it("writes stdinData to the child's stdin and ends it when stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      stdinData: "prompt text",
    });

    child.emit("close", 0);
    await resultPromise;

    expect(child.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("merges extraEnv into process.env for the spawned child", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      env: { MY_FLAG: "1" },
    });
    child.emit("close", 0);
    await resultPromise;

    const spawnCallOpts = vi.mocked(spawn).mock.calls[0]![2] as { env: Record<string, string> };
    expect(spawnCallOpts.env.MY_FLAG).toBe("1");
    // Original process.env vars are preserved alongside the extra ones.
    expect(spawnCallOpts.env.PATH).toBe(process.env.PATH);
  });

  it("resolves with exitCode 1 (default) and manifest exitCode 1 when a tracked child exits with a null code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-null-code", stage: "planner", runtime: "claude-code" },
    });

    const [{ id }] = runner.getActiveProcesses();
    child.emit("close", null);
    const result = await resultPromise;

    expect(result.exitCode).toBe(1);
    const manifest = JSON.parse(readFileSync(join(spoolDir, `${id}.json`), "utf-8")) as {
      exitCode?: number;
    };
    expect(manifest.exitCode).toBe(1);
  });

  it("resolves with exitCode 1 (default) when the child exits with a null code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
    });
    child.emit("close", null);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
  });
});

describe("ProcessRunner — executeReal() with process tracking context", () => {
  function makeContext() {
    return { runId: "run-1", stage: "planner", runtime: "claude-code" };
  }

  it("tracks the process while active, writes a manifest, and emits process:started", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild(5555);
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: makeContext(),
    });

    // While the process is "running" (before 'close'), it should show up as active.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.id).toBe("string");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      "claude",
    );

    // A manifest file should have been written for this process.
    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { pid: number; runId: string };
    expect(manifest.pid).toBe(5555);
    expect(manifest.runId).toBe("run-1");

    child.emit("close", 0);
    await resultPromise;

    // Once closed, the process is no longer active and the manifest records completion.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    const finishedManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(finishedManifest.completedAt).toBeDefined();
    expect(finishedManifest.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("getProcessOutput() returns the live rollingBuffer while the process is active", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: makeContext(),
    });

    const [{ id }] = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(id)).toBe("partial output");

    child.emit("close", 0);
    await resultPromise;
  });

  it("without a context, does not track an active process entry or write a manifest", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("appendToBuffer truncates the rolling buffer once it exceeds the max size", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: makeContext(),
    });

    const [{ id }] = runner.getActiveProcesses();
    const bigChunk = "A".repeat(9000); // exceeds ROLLING_BUFFER_MAX (8 * 1024)
    child.stdout.emit("data", Buffer.from(bigChunk));

    const buffered = runner.getProcessOutput(id);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBe(8 * 1024);
    expect(buffered).toBe(bigChunk.slice(-8 * 1024));

    child.emit("close", 0);
    await resultPromise;
  });

  it("throttles process:output emissions and slices long chunks to the last 500 characters", async () => {
    vi.useFakeTimers();
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: makeContext(),
    });

    // First emission happens immediately (lastEmitMs starts at 0).
    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // A second emission within the throttle window (250ms) is suppressed.
    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // After the throttle window elapses, the next chunk is emitted, sliced to 500 chars.
    vi.advanceTimersByTime(300);
    const longChunk = "B".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    const [, , chunkArg] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(chunkArg).toBe(longChunk.slice(-500));

    child.emit("close", 0);
    await resultPromise;
  });
});

describe("ProcessRunner — executeReal() error handling", () => {
  it("rejects with the spawn error and cleans up the tracked process", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-err", stage: "executor", runtime: "claude-code" },
    });

    const spawnError = new Error("spawn ENOENT");
    child.emit("error", spawnError);

    await expect(resultPromise).rejects.toThrow("spawn ENOENT");
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-err",
      expect.any(String),
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("rejects with the raw spawn error when no context/processId was assigned", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
    });

    child.emit("error", new Error("boom"));
    await expect(resultPromise).rejects.toThrow("boom");
  });

  it("cleanupProcess is idempotent: a second 'close' event for an already-cleaned process is a no-op", async () => {
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-double-close", stage: "planner", runtime: "claude-code" },
    });

    child.emit("close", 0);
    await resultPromise;
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

    // A spurious second 'close' event must not throw or emit again: the
    // entry was already removed by the first cleanupProcess() call.
    expect(() => child.emit("close", 0)).not.toThrow();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
  });

  it("cleanupProcess tolerates a missing/corrupt manifest file on close (best-effort write)", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-2", stage: "planner", runtime: "claude-code" },
    });

    const [{ id }] = runner.getActiveProcesses();
    // Delete the manifest file before the process closes, forcing the
    // best-effort readFileSync/writeFileSync update in cleanupProcess to fail silently.
    rmSync(join(spoolDir, `${id}.json`));

    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe("ProcessRunner — executeReal() timeout handling", () => {
  it("sends SIGTERM on timeout and rejects with AgentTimeoutError using the runtime/stage label", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
    });

    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate the child actually exiting after being killed.
    child.emit("close", 143);

    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
    await expect(resultPromise).rejects.toThrow(/claude-code\/executor/);
  });

  it("escalates to SIGKILL 5s after SIGTERM if the child has not exited", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    // Override kill so SIGTERM does NOT flip `killed` (simulating a stuck process).
    child.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.advanceTimersByTime(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", 137);
    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL if the child reports killed:true after SIGTERM", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild(); // default kill() sets child.killed = true
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    // Only the SIGTERM call — no SIGKILL escalation since child.killed was true.
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", 143);
    await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
  });

  it("uses the bare command as the timeout label when no context was provided", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "my-cli-tool",
      args: [],
      cwd: "/tmp",
      timeoutMs: 500,
    });

    vi.advanceTimersByTime(500);
    child.emit("close", 1);

    await expect(resultPromise).rejects.toThrow(/my-cli-tool/);
  });

  it("clears the timeout and does not kill the child when it closes before the timeout fires", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
    });

    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.timedOut).toBe(false);

    // Advancing time well past the timeout must not retroactively kill anything.
    vi.advanceTimersByTime(120_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — rehydrateOrphans()", () => {
  function writeManifest(id: string, data: Record<string, unknown>) {
    writeFileSync(join(spoolDir, `${id}.json`), JSON.stringify(data, null, 2));
  }

  it("does nothing (no throw) when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("skips manifests that are already marked completed", () => {
    writeManifest("done-proc", {
      id: "done-proc",
      pid: 1,
      command: "claude",
      args: [],
      runId: "run-x",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "done-proc.log"),
      completedAt: new Date().toISOString(),
      exitCode: 0,
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("marks a dead orphan (unresponsive pid) as crashed and persists the update", () => {
    writeManifest("dead-proc", {
      id: "dead-proc",
      pid: 999_999, // assumed not to exist
      command: "claude",
      args: [],
      runId: "run-y",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "dead-proc.log"),
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(join(spoolDir, "dead-proc.json"), "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
      crashed?: boolean;
    };
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toEqual([]);

    killSpy.mockRestore();
  });

  it("rehydrates a live orphan: restores rollingBuffer, emits process:started, and sets up log tailing", () => {
    const logPath = join(spoolDir, "live-proc.log");
    writeFileSync(logPath, "previously logged output\n");
    writeManifest("live-proc", {
      id: "live-proc",
      pid: 777,
      command: "claude --print",
      args: ["--print"],
      runId: "run-z",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    // Fake timers before rehydrateOrphans() so the orphan-tailing pollInterval
    // it schedules can be deterministically advanced (and finalized) below,
    // instead of leaking a real 5s interval past the end of this test.
    vi.useFakeTimers();
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live-proc", pid: 777 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-z",
      "live-proc",
      "planner",
      "claude-code",
      "claude --print",
    );
    expect(runner.getProcessOutput("live-proc")).toBe("previously logged output\n");
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "live-proc", pid: 777, runId: "run-z" });

    // Finalize deterministically so no interval/watcher/log stream is left
    // dangling past the end of this test.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toEqual([]);

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    writeFileSync(join(spoolDir, "corrupt-proc.json"), "{ not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt-proc.json" }),
      "Failed to process manifest",
    );
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("ignores non-.json files in the spool directory", () => {
    writeFileSync(join(spoolDir, "stray.log"), "not a manifest");
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("tolerates a missing log file for a live orphan (empty rollingBuffer)", () => {
    writeManifest("no-log-proc", {
      id: "no-log-proc",
      pid: 888,
      command: "claude",
      args: [],
      runId: "run-w",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "no-log-proc.log"),
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("no-log-proc")).toBe("");

    // Finalize deterministically to avoid leaking the polling interval.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toEqual([]);

    killSpy.mockRestore();
  });

  it("finalizeOrphan is idempotent: calling it again for an already-finalized id is a no-op", () => {
    writeManifest("idempotent-proc", {
      id: "idempotent-proc",
      pid: 1111,
      command: "claude",
      args: [],
      runId: "run-idem",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "idempotent-proc.log"),
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.useFakeTimers();
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Let the orphan die naturally so the real pollInterval/watcher are
    // properly cleared by the production code's own finalizeOrphan() call.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

    // Now reach into the private finalizeOrphan() directly to verify its own
    // `if (!entry) return;` guard: calling it again for the same, now-absent,
    // id must be a safe no-op (no duplicate completion event).
    const internal = runner as unknown as { finalizeOrphan(id: string): void };
    expect(() => internal.finalizeOrphan("idempotent-proc")).not.toThrow();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

    killSpy.mockRestore();
  });
});

describe("ProcessRunner — tailLogForOrphan() watch callback behavior", () => {
  function writeManifest(id: string, pid: number, logPath: string) {
    writeFileSync(join(spoolDir, `${id}.json`), JSON.stringify({
      id,
      pid,
      command: "claude",
      args: [],
      runId: "run-tail",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    }, null, 2));
  }

  it("appends newly written log content to the rolling buffer on a watch event", () => {
    const logPath = join(spoolDir, "tail-proc.log");
    writeFileSync(logPath, "initial\n");
    writeManifest("tail-proc", 1234, logPath);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("tail-proc")).toBe("initial\n");

    // Simulate the log file growing, then fire the captured fs.watch callback.
    writeFileSync(logPath, "initial\nmore output\n", { flag: "a" });
    const cb = watchCallbacks.get(logPath);
    expect(cb).toBeDefined();
    cb!("change", "tail-proc.log");

    expect(runner.getProcessOutput("tail-proc")).toContain("more output");

    // Finalize deterministically to avoid leaking the polling interval.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toEqual([]);

    killSpy.mockRestore();
  });

  it("silently ignores a read error from the watch callback (log file removed mid-tail)", () => {
    const logPath = join(spoolDir, "unreadable-proc.log");
    writeFileSync(logPath, "initial\n");
    writeManifest("unreadable-proc", 2222, logPath);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("unreadable-proc")).toBe("initial\n");

    // Remove the log file before the watch callback fires, forcing
    // readFileSync inside the callback to throw; it must be swallowed.
    rmSync(logPath);
    const cb = watchCallbacks.get(logPath)!;
    expect(() => cb("change", "unreadable-proc.log")).not.toThrow();

    // The rolling buffer is unchanged since the read failed.
    expect(runner.getProcessOutput("unreadable-proc")).toBe("initial\n");

    killSpy.mockRestore();
  });

  it("finalizeOrphan tolerates a missing manifest file (best-effort update)", () => {
    const logPath = join(spoolDir, "no-manifest-proc.log");
    writeFileSync(logPath, "data\n");
    writeManifest("no-manifest-proc", 3333, logPath);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.useFakeTimers();
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Delete the manifest before the dead-pid check fires, so finalizeOrphan's
    // best-effort manifest read/write fails and is swallowed.
    rmSync(join(spoolDir, "no-manifest-proc.json"));
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-tail",
      "no-manifest-proc",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );

    killSpy.mockRestore();
  });

  it("closes the watcher and returns early when the tracked process entry is gone", () => {
    const logPath = join(spoolDir, "gone-proc.log");
    writeFileSync(logPath, "data\n");
    writeManifest("gone-proc", 4321, logPath);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    // Fake timers must be active BEFORE rehydrateOrphans() schedules its
    // setInterval poll, so that interval is the one advanced below.
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    // Force the active entry to disappear by finalizing it directly through the
    // dead-pid path: simulate the pid dying on the *next* liveness check instead.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    vi.advanceTimersByTime(5000); // triggers the pollInterval's liveness check -> finalizeOrphan
    const closeMock = watchCloseMocks.get(logPath)!;
    expect(closeMock).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);

    // Now that the entry is gone, a late watch callback should close the watcher
    // again (no-op) and not throw.
    const cb = watchCallbacks.get(logPath)!;
    expect(() => cb("change", "gone-proc.log")).not.toThrow();

    killSpy.mockRestore();
  });

  it("finalizeOrphan updates the manifest, emits process:completed, and removes the active entry", () => {
    const logPath = join(spoolDir, "finalize-proc.log");
    writeFileSync(logPath, "data\n");
    writeManifest("finalize-proc", 5678, logPath);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.useFakeTimers();
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-tail",
      "finalize-proc",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    const manifest = JSON.parse(readFileSync(join(spoolDir, "finalize-proc.json"), "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(-1);

    killSpy.mockRestore();
  });
});
