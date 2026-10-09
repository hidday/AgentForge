import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

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
  pid: number | undefined = 4242;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    return true;
  });
}

function makeFakeChild(): FakeChildProcess {
  return new FakeChildProcess();
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  vi.mocked(spawn).mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Give any pending async fs operations (createWriteStream opens, fs.watch
  // teardown) a couple of real event-loop turns to settle before the spool
  // directory is removed, so they don't throw ENOENT after the test ends.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("ProcessRunner — mock mode", () => {
  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const expected = {
      stdout: "mock out",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(expected);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result).toEqual(expected);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("throws when mock mode is enabled but no handler is configured", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner — real mode: success and exit codes", () => {
  it("resolves with captured stdout/stderr and exitCode 0 on normal completion", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: x"));
    child.emit("close", 0);

    const result = await promise;

    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn: x");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
  });

  it("resolves (does not reject) with the non-zero exit code when the process exits normally", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("treats a null exit code as 1", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.emit("close", null);
    const result = await promise;
    expect(result.exitCode).toBe(1);
  });
});

describe("ProcessRunner — real mode: stdin handling", () => {
  it("writes and ends stdin when stdinData is provided", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "codex",
      args: ["exec", "-"],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "please respond",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("please respond");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("only ends stdin (never writes) when no stdinData is provided", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — real mode: error event", () => {
  it("rejects with the spawn error (e.g. ENOENT) when no context is tracked", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "nonexistent-binary",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    const err = Object.assign(new Error("spawn nonexistent-binary ENOENT"), { code: "ENOENT" });
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn nonexistent-binary ENOENT");
  });

  it("cleans up the tracked process entry and emits process:completed(-1) when a tracked process errors", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "nonexistent-binary",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    // the process was registered as active before the error fires
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "executor",
      "claude-code",
      "nonexistent-binary",
    );

    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn ENOENT");
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner — real mode: context tracking, active processes, manifest", () => {
  it("tracks an active process mid-flight and writes a manifest file, then cleans up on close", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-42", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });
    const processId = active[0]!.id;

    // manifest file written to the spool dir
    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: processId,
      pid: 4242,
      command: "claude",
      runId: "run-42",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(manifest.completedAt).toBeUndefined();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "planner",
      "claude-code",
      "claude",
    );

    child.stdout.emit("data", Buffer.from("partial output"));
    // rolling buffer reflects output while active, via getProcessOutput
    expect(runner.getProcessOutput(processId)).toBe("partial output");

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(updatedManifest.completedAt).toBeDefined();
    expect(updatedManifest.exitCode).toBe(0);
  });

  it("does not track a process (no manifest, no active entry) when no context is passed", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 5000 });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not track a process when context is passed but the child has no pid", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — getProcessOutput", () => {
  it("returns null when the process is neither active nor has a log file on disk", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads the tail of the log file from disk when the process is no longer active", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const processId = "finished-process";
    writeFileSync(join(spoolDir, `${processId}.log`), "some archived output");

    expect(runner.getProcessOutput(processId)).toBe("some archived output");
  });
});

describe("ProcessRunner — real mode: timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("kills with SIGTERM on timeout, then SIGKILL after the grace period if still alive, and rejects with AgentTimeoutError", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });
    promise.catch(() => {
      // swallow for the fake-timer advancing below; asserted on the awaited rejection later
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    // child did not actually die from SIGTERM (killed stays false) -> grace-period SIGKILL fires
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);

    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not send SIGKILL in the grace period if the process already died from SIGTERM", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    child.kill = vi.fn((_signal?: string) => {
      child.killed = true;
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    promise.catch(() => {
      // handled via awaited rejection below
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("includes the runtime/stage label in the AgentTimeoutError when context is present", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 500,
      context: { runId: "run-9", stage: "reviewer", runtime: "codex" },
    });
    promise.catch(() => {
      // handled below
    });

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(5000);
    child.emit("close", null);

    await expect(promise).rejects.toThrow(/codex\/reviewer/);
    // cleanupProcess is invoked from the close handler with the actual close
    // code (`code ?? 1`), not -1 — -1 is reserved for the error-event path.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      expect.any(String),
      "reviewer",
      "codex",
      1,
      expect.any(Number),
    );
  });

  it("does not time out when the process closes before the timeout fires", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.emit("close", 0);
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — output throttling to the emitter", () => {
  it("emits process:output chunks (throttled) and truncates long chunks to the last 500 chars", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-5", stage: "executor", runtime: "claude-code" },
    });

    const longChunk = "y".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(emittedChunk).toHaveLength(500);
    expect(emittedChunk).toBe(longChunk.slice(-500));

    // a second chunk within the throttle window should NOT trigger another emit
    child.stdout.emit("data", Buffer.from("more"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // advance past the throttle window, then another chunk should emit again
    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("after throttle"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files and manifests that are already completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "claude",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: "x",
        completedAt: new Date().toISOString(),
      }),
    );

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file is corrupt JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 999_999,
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
      expect.objectContaining({ processId: "dead", pid: 999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("rehydrates a manifest whose pid is still alive: registers it active, restores buffer from log, and emits process:started", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const logPath = join(spoolDir, "alive.log");
    writeFileSync(logPath, "previously logged output");
    const manifestPath = join(spoolDir, "alive.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive",
        pid: 12345,
        command: "claude",
        args: ["--print"],
        runId: "run-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    try {
      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive", pid: 12345, stage: "executor" }),
        "Rehydrating orphaned agent process",
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive",
        "executor",
        "claude-code",
        "claude",
      );

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive", pid: 12345, runId: "run-alive" });
      expect(runner.getProcessOutput("alive")).toBe("previously logged output");
    } finally {
      // Simulate the orphan dying so the internal poll interval + fs.watch
      // created by rehydration are torn down instead of leaking handles.
      killSpy.mockImplementation(() => {
        throw new Error("ESRCH");
      });
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(5_000);
      vi.useRealTimers();
      killSpy.mockRestore();
    }
  });

  it("finalizes a rehydrated orphan once its poll detects the pid has died, updating the manifest and emitting process:completed", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    let callCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      callCount += 1;
      // First call (liveness check during rehydrate) succeeds; subsequent
      // polls report the process has died.
      if (callCount === 1) return true;
      throw new Error("ESRCH");
    });

    const logPath = join(spoolDir, "poll.log");
    writeFileSync(logPath, "output so far");
    const manifestPath = join(spoolDir, "poll.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "poll",
        pid: 55555,
        command: "claude",
        args: [],
        runId: "run-poll",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.useFakeTimers();
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-poll",
      "poll",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "poll", pid: 55555 }),
      "Orphaned process has exited",
    );

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(updated.completedAt).toBeDefined();
    expect(updated.exitCode).toBe(-1);

    killSpy.mockRestore();
  });
});

describe("ProcessRunner — constructor", () => {
  it("creates the spool directory recursively if it does not already exist", () => {
    const nested = join(spoolDir, "a", "b", "c");
    expect(existsSync(nested)).toBe(false);
    const logger = makeMockLogger();
    // eslint-disable-next-line no-new
    new ProcessRunner("real", logger as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("defaults the spool directory to .foundry/processes when none is provided", () => {
    const logger = makeMockLogger();
    const preexisting = existsSync(".foundry/processes");
    const runner = new ProcessRunner("mock", logger as never);
    expect(runner).toBeInstanceOf(ProcessRunner);
    expect(existsSync(".foundry/processes")).toBe(true);
    // Only clean up the directory this test created; leave any pre-existing
    // real spool directory alone (.foundry/ is gitignored, local-only state).
    if (!preexisting) {
      rmSync(".foundry", { recursive: true, force: true });
    }
  });
});
