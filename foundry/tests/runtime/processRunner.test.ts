import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTimeoutError } from "../../src/utils/errors.js";

// ProcessRunner spawns real OS subprocesses in "real" mode via node:child_process.
// We mock spawn() to return a fake EventEmitter-based ChildProcess so no real
// process is ever started. We also mock node:fs's `watch` (used only by the
// orphan-rehydration log tailer) to a controllable stub, while leaving every
// other fs function as the real implementation so manifest/log files are
// written to a real temp directory and can be asserted on directly.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, watch: vi.fn() };
});

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";

const spawnMock = vi.mocked(spawn);
const watchMock = vi.mocked(watch);

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  spawnMock.mockReset();
  watchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  // Deliberately not rm'ing spoolDir here: createWriteStream's underlying
  // open() is async and can still be in flight after a test resolves (e.g.
  // the timeout tests, which never flush a real log). Removing the directory
  // immediately races with that and throws unhandled ENOENT errors. Each
  // test uses its own freshly-created temp dir, so leaving them for the OS
  // to reap is harmless.
});

describe("ProcessRunner — mock mode", () => {
  it("throws when execute() is called without a mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    const handlerResult = { stdout: "ok", stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const options = { command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result).toBe(handlerResult);
  });
});

describe("ProcessRunner — real mode, basic success path (no context)", () => {
  it("resolves stdout/stderr/exitCode and ends stdin immediately when there is no stdinData", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const runner = new ProcessRunner("real", makeLogger() as never, makeEmitter() as never, spoolDir);
    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).not.toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from("hello "));
    child.stderr.emit("data", Buffer.from("warn "));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello ");
    expect(result.stderr).toBe("warn ");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");

    // No context was provided, so nothing should be tracked as active.
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("writes stdinData then ends stdin when stdinData is provided", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "input payload",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("input payload");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) with a non-zero exitCode when the process exits uncleanly without timing out", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the child's error when the subprocess emits an 'error' event", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "bogus", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("error", new Error("spawn ENOENT"));

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });
});

describe("ProcessRunner — real mode with a process context (tracking, manifest, emitter)", () => {
  it("tracks the process in getActiveProcesses(), writes a manifest, and emits started/completed events", async () => {
    const child = makeFakeChild(5555);
    spawnMock.mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const context = { runId: "run-1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute({
      command: "claude",
      args: ["--model", "x"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "claude",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0].elapsedMs).toBe("number");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "executor",
      "claude-code",
      "claude",
    );

    // A manifest file should exist for this process.
    const manifestPath = join(spoolDir, `${active[0].id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
    };
    expect(manifestBefore.completedAt).toBeUndefined();

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);

    // Process should no longer be tracked as active once it completes.
    expect(runner.getActiveProcesses()).toEqual([]);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(manifestAfter.completedAt).toBeDefined();
    expect(manifestAfter.exitCode).toBe(0);
  });

  it("emits output chunks via emitProcessOutput, truncated to the last 500 characters", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "planner", runtime: "claude-code" },
    });

    const longChunk = "A".repeat(600) + "[END]";
    child.stdout.emit("data", Buffer.from(longChunk));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((emittedChunk as string).length).toBeLessThanOrEqual(500);
    expect(emittedChunk).toContain("[END]");

    child.emit("close", 0);
    await promise;
  });

  it("throttles rapid successive output emissions within OUTPUT_THROTTLE_MS", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("first chunk"));
    child.stdout.emit("data", Buffer.from("second chunk, right after"));

    // The first chunk always emits (lastEmitMs starts at 0); the second,
    // arriving well inside the 250ms throttle window, should be suppressed.
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("rolls the in-memory buffer over at ROLLING_BUFFER_MAX (8KB), keeping only the tail", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-4", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses()[0]!;
    const bigChunk = "x".repeat(9000) + "[TAIL]";
    child.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(active.id);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toContain("[TAIL]");

    child.emit("close", 0);
    await promise;
  });

  it("cleans up and reports exitCode -1 via emitProcessCompleted when the child errors out", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-5", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses()[0]!;
    child.emit("error", new Error("boom"));

    await expect(promise).rejects.toThrow("boom");
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-5",
      active.id,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner — real mode timeout handling", () => {
  it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-6", stage: "executor", runtime: "claude-code" },
    });
    // Swallow the rejection until we're ready to assert on it, so Node does
    // not report an unhandled rejection while timers are being advanced.
    const settled = promise.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate the OS having actually terminated it before the 5s escalation
    // window elapses — no SIGKILL should be sent in that case.
    child.killed = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    const err = await settled;
    expect(err).toBeInstanceOf(AgentTimeoutError);
  });

  it("escalates to SIGKILL after 5s when the process has not exited from SIGTERM", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    const settled = promise.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    // child.killed stays false — simulate a hung process
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    const err = await settled;
    expect(err).toBeInstanceOf(AgentTimeoutError);
  });
});

describe("ProcessRunner — getProcessOutput", () => {
  it("returns null when the process is not active and no log file exists", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("falls back to reading the on-disk log file (tail only) when the process is no longer active", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const processId = "finished-proc";
    const content = "y".repeat(9000) + "[LOGTAIL]";
    writeFileSync(join(spoolDir, `${processId}.log`), content);

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toContain("[LOGTAIL]");
  });
});

describe("ProcessRunner — rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be read", () => {
    rmSync(spoolDir, { recursive: true, force: true });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // The constructor recreates the dir; remove it again to force readdirSync to fail.
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("skips manifests that are already marked completed", () => {
    writeFileSync(
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 1,
        command: "x",
        args: [],
        runId: "run-done",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );
    const killSpy = vi.spyOn(process, "kill");
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const manifestPath = join(spoolDir, "dead-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: 99999,
        command: "x",
        args: [],
        runId: "run-dead",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 99999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
      crashed?: boolean;
    };
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.crashed).toBe(true);
    expect(runner.getActiveProcesses()).toEqual([]);
    killSpy.mockRestore();
  });

  it("logs a warning (and continues) when a manifest file contains invalid JSON", () => {
    writeFileSync(join(spoolDir, "corrupt-proc.json"), "{not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt-proc.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphan: tracks it, emits started, tails new log content, and finalizes it when it dies", async () => {
    vi.useFakeTimers();

    const processId = "alive-proc";
    const logPath = join(spoolDir, `${processId}.log`);
    const manifestPath = join(spoolDir, `${processId}.json`);
    writeFileSync(logPath, "line1\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 7777,
        command: "claude",
        args: [],
        runId: "run-orphan",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let capturedWatchCallback: (() => void) | undefined;
    const watcherClose = vi.fn();
    watchMock.mockImplementation((_path, cb) => {
      capturedWatchCallback = cb as () => void;
      return { close: watcherClose } as never;
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-orphan",
      processId,
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput(processId)).toBe("line1\n");

    // Simulate new content appended to the log file and the watcher firing.
    writeFileSync(logPath, "line1\nline2 appended\n");
    expect(capturedWatchCallback).toBeDefined();
    capturedWatchCallback!();

    expect(runner.getProcessOutput(processId)).toContain("line2 appended");

    // Now simulate the process dying: the next poll's process.kill(pid, 0)
    // throws, which should finalize the orphan.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(watcherClose).toHaveBeenCalledTimes(1);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-orphan",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(manifestAfter.completedAt).toBeDefined();
    expect(manifestAfter.exitCode).toBe(-1);

    // Invoking the watch callback again after finalization should close the
    // watcher (the entry is now gone) rather than throw.
    capturedWatchCallback!();
    expect(watcherClose).toHaveBeenCalledTimes(2);

    killSpy.mockRestore();
  });
});
