import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessContext, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

const ROLLING_BUFFER_MAX = 8 * 1024;

/** Polls a condition instead of relying on a single fixed sleep, to avoid
 * flakiness under slower/loaded CI machines while still failing fast. */
async function waitFor(check: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (!check()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
  }
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Give any pending real fs callbacks (e.g. a watcher's internal close
  // teardown from a test that finalized an orphan under fake timers) one
  // event-loop turn to settle before we delete the directory they reference.
  await new Promise((r) => setImmediate(r));
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory if it does not exist", () => {
    const nested = join(spoolDir, "nested", "dir");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("mock", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("throws when no mock handler is configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and logs the call", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
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

    expect(result.stdout).toBe("mocked");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"] }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner real mode — basic exec outcomes", () => {
  it("resolves with stdout, exitCode 0 and timedOut:false on success", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: "node",
      args: ["-e", "console.log('hello-world')"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures stderr and a non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: "node",
      args: ["-e", "console.error('bad-thing'); process.exit(3)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("bad-thing");
  });

  it("writes stdinData to the child process and captures its echoed output", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: "node",
      args: ["-e", "let c='';process.stdin.on('data',d=>c+=d);process.stdin.on('end',()=>console.log(c))"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdinData: "ping-payload",
    });

    expect(result.stdout).toContain("ping-payload");
  });

  it("rejects with AgentTimeoutError when the process exceeds timeoutMs", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: process.cwd(),
        timeoutMs: 80,
      }),
    ).rejects.toThrow(AgentTimeoutError);
  });

  it("labels the timeout error using context runtime/stage when context is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "codex" };
    try {
      await runner.execute({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: process.cwd(),
        timeoutMs: 80,
        context,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AgentTimeoutError);
      const e = err as AgentTimeoutError;
      expect(e.agent).toBe("codex/executor");
      expect(e.timeoutMs).toBe(80);
    }
  });

  it("rejects with the spawn error for a nonexistent command (no context)", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({
        command: "this-command-does-not-exist-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });

  it("rejects with the spawn error for a nonexistent command (with context, exercising cleanup)", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const context: ProcessContext = { runId: "run-err", stage: "planner", runtime: "claude-code" };
    await expect(
      runner.execute({
        command: "this-command-does-not-exist-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 2000,
        context,
      }),
    ).rejects.toThrow();

    // cleanupProcess runs even on spawn error when a processId was allocated,
    // but since spawn failed there is no child.pid so no manifest is written
    // and no active-process entry exists to clean up. Nothing should throw.
    expect(runner.getActiveProcesses()).toEqual([]);
  });
});

describe("ProcessRunner real mode — process context tracking (manifest, logs, active list)", () => {
  it("tracks an active process during execution and cleans up after completion", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "run-abc", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute({
      command: "node",
      args: ["-e", "setTimeout(() => { console.log('done'); }, 120)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    // Spawn + bookkeeping happen synchronously before any await inside
    // executeReal, so the active-process entry exists immediately.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]!.runId).toBe("run-abc");
    expect(active[0]!.stage).toBe("planner");
    expect(active[0]!.runtime).toBe("claude-code");
    expect(active[0]!.pid).toBeGreaterThan(0);
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    const processId = active[0]!.id;
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-abc",
      processId,
      "planner",
      "claude-code",
      "node",
    );

    // Manifest file was written before the process completed.
    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore.completedAt).toBeUndefined();
    expect(manifestBefore.pid).toBe(active[0]!.pid);

    const result = await promise;
    expect(result.exitCode).toBe(0);

    // Active process entry is removed after completion.
    expect(runner.getActiveProcesses()).toEqual([]);

    // Manifest updated with completion info.
    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.completedAt).toBeDefined();
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.durationMs).toBe("number");

    // Log file captured stdout content.
    const logPath = join(spoolDir, `${processId}.log`);
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain("done");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-abc",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    // getProcessOutput reads from the log file once the process is no longer active.
    expect(runner.getProcessOutput(processId)).toContain("done");
  });

  it("getProcessOutput returns the in-memory rolling buffer while the process is still active", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const context: ProcessContext = { runId: "run-live", stage: "executor", runtime: "codex" };

    const promise = runner.execute({
      command: "node",
      args: ["-e", "process.stdout.write('partial-output'); setTimeout(() => process.exit(0), 150)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    const active = runner.getActiveProcesses();
    const processId = active[0]!.id;

    // Give the stdout 'data' event a real moment to fire while the child is
    // still alive (it exits after 150ms); poll rather than a fixed sleep so
    // this isn't flaky on a slower/loaded machine.
    await waitFor(() => (runner.getProcessOutput(processId)?.length ?? 0) > 0, 1000, 10);

    const liveOutput = runner.getProcessOutput(processId);
    expect(liveOutput).toContain("partial-output");

    await promise;
    // After completion the entry is gone; output now comes from the log file.
    expect(runner.getProcessOutput(processId)).toContain("partial-output");
  });

  it("returns null from getProcessOutput for an unknown process id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("no-such-process")).toBeNull();
  });

  it("returns null from getProcessOutput when the log path exists but is unreadable as a file", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    // Create a directory where a .log file would be, so existsSync is true
    // but readFileSync throws (EISDIR), exercising the catch branch.
    mkdirSync(join(spoolDir, "weird-id.log"));
    expect(runner.getProcessOutput("weird-id")).toBeNull();
  });

  it("truncates the rolling buffer to ROLLING_BUFFER_MAX characters for large output", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const context: ProcessContext = { runId: "run-big", stage: "executor", runtime: "codex" };
    const totalChars = ROLLING_BUFFER_MAX * 3;

    const promise = runner.execute({
      command: "node",
      args: ["-e", `process.stdout.write('a'.repeat(${totalChars}))`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    await promise;

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(ROLLING_BUFFER_MAX);
    expect(output).toBe("a".repeat(ROLLING_BUFFER_MAX));

    // The full untruncated content is still preserved on disk in the log file.
    const logPath = join(spoolDir, `${processId}.log`);
    expect(readFileSync(logPath, "utf-8").length).toBe(totalChars);
  });
});

describe("ProcessRunner real mode — throttled output emission", () => {
  it("emits the first output chunk immediately, then throttles until OUTPUT_THROTTLE_MS has passed", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "run-throttle", stage: "planner", runtime: "claude-code" };

    // Writes 'a' then 'b' immediately (well within the 250ms throttle window,
    // so at most one emit results from them), then writes 'c' after a real
    // 320ms delay (past the throttle window), which must produce a second,
    // separate emit call.
    const script =
      "process.stdout.write('a');process.stdout.write('b');" +
      "setTimeout(() => { process.stdout.write('c'); process.exit(0); }, 320);";

    const result = await runner.execute({
      command: "node",
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    expect(result.stdout).toBe("ab" + "c");
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = emitter.emitProcessOutput.mock.calls;
    expect(firstCall![0]).toBe("run-throttle");
    expect(typeof firstCall![1]).toBe("string");
    expect(firstCall![2]).toContain("a");
    expect(secondCall![2]).toContain("c");
  });

  it("does not attempt to emit output when no emitter is configured", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const context: ProcessContext = { runId: "run-no-emitter", stage: "planner", runtime: "claude-code" };
    // Should simply not throw despite producing output with context tracking on.
    const result = await runner.execute({
      command: "node",
      args: ["-e", "console.log('fine')"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });
    expect(result.stdout).toContain("fine");
  });

  it("truncates an individual emitted chunk to its last 500 characters", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "run-chunk", stage: "planner", runtime: "claude-code" };
    const bigChunk = 700;

    await runner.execute({
      command: "node",
      args: ["-e", `process.stdout.write('z'.repeat(${bigChunk}))`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const chunkArg = emitter.emitProcessOutput.mock.calls[0]![2] as string;
    expect(chunkArg.length).toBe(500);
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("does nothing (no throw) when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("does nothing when there are no manifest files", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("skips manifests that already have a completedAt", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 999999,
        command: "node",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("logs a warning and skips a manifest file with invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest crashed when its pid is not alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    // PID 999999999 is extremely unlikely to correspond to a live process.
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 999999999,
        command: "node",
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
      expect.objectContaining({ processId: "dead", pid: 999999999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("rehydrates an orphan with a live pid, restoring buffered output and emitting process:started", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive.log");
    writeFileSync(logPath, "previously logged output");
    writeFileSync(
      join(spoolDir, "alive.json"),
      JSON.stringify({
        id: "alive",
        pid: 313131,
        command: "node",
        args: [],
        runId: "run-alive",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.useFakeTimers();
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as unknown as typeof process.kill);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: 313131 }),
      "Rehydrating orphaned agent process",
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("alive");
    expect(active[0]!.runId).toBe("run-alive");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive",
      "executor",
      "codex",
      "node",
    );

    expect(runner.getProcessOutput("alive")).toBe("previously logged output");

    // Force the orphan's poll to detect death so its watcher/interval close
    // cleanly before the temp directory is torn down.
    killSpy.mockImplementation(() => {
      throw new Error("kill ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("tails subsequent log growth into the rolling buffer for a rehydrated orphan", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const logPath = join(spoolDir, "tailed.log");
    writeFileSync(logPath, "start-content");
    writeFileSync(
      join(spoolDir, "tailed.json"),
      JSON.stringify({
        id: "tailed",
        pid: 313132,
        command: "node",
        args: [],
        runId: "run-tailed",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.useFakeTimers();
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as unknown as typeof process.kill);

    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("tailed")).toBe("start-content");

    // Append to the log file to trigger the fs.watch callback that feeds
    // appendToBuffer with the newly written chunk. fs.watch is a real,
    // OS-driven mechanism unaffected by fake timers; advancing the fake
    // clock (a small amount, well under the 5s poll) still yields the event
    // loop so the real watch event gets a chance to fire.
    writeFileSync(logPath, "start-content-more", { flag: "a" });
    // Poll under fake timers: each advance yields to the real event loop
    // (letting the real fs.watch callback fire) without waiting real wall
    // time beyond what's actually needed.
    for (let i = 0; i < 20 && !runner.getProcessOutput("tailed")?.includes("more"); i++) {
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(runner.getProcessOutput("tailed")).toContain("more");

    // Force the orphan's poll to detect death so its watcher/interval close
    // cleanly before the temp directory is torn down.
    killSpy.mockImplementation(() => {
      throw new Error("kill ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("finalizes an orphan once its process disappears, without waiting real time", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "vanish.log");
    writeFileSync(logPath, "");
    const manifestPath = join(spoolDir, "vanish.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "vanish",
        pid: 424242,
        command: "node",
        args: [],
        runId: "run-vanish",
        stage: "reviewer",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let killCalls = 0;
    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: unknown) => {
      killCalls++;
      // First call: rehydrateOrphans' own liveness check -> report alive.
      if (killCalls === 1) return true;
      // Subsequent calls: the 5s poll inside tailLogForOrphan -> report dead.
      throw new Error("kill ESRCH");
    }) as unknown as typeof process.kill);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Advance the fake clock past the 5s poll interval; the poll's
    // process.kill check now throws, triggering finalizeOrphan().
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-vanish",
      "vanish",
      "reviewer",
      "codex",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "vanish", pid: 424242 }),
      "Orphaned process has exited",
    );

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(-1);
  });

  it("keeps the orphan active across a poll tick while its pid remains alive", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const logPath = join(spoolDir, "still-alive.log");
    writeFileSync(logPath, "");
    writeFileSync(
      join(spoolDir, "still-alive.json"),
      JSON.stringify({
        id: "still-alive",
        pid: 555555,
        command: "node",
        args: [],
        runId: "run-still-alive",
        stage: "reviewer",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as unknown as typeof process.kill);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // The poll fires but process.kill keeps reporting the pid alive, so the
    // orphan must not be finalized.
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Now let it "die" so its watcher/interval close cleanly before teardown.
    killSpy.mockImplementation(() => {
      throw new Error("kill ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toEqual([]);
  });
});
