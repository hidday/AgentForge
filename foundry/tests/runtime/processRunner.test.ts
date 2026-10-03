import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

// Only `watch` is replaced — everything else in node:fs stays real so the
// manifest/log-spooling code can operate against a real temp directory.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
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
    timeoutMs: 10_000,
    ...overrides,
  };
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  // Deliberately not removing spoolDir here: the real fs.WriteStream used
  // for process logs flushes asynchronously (createWriteStream's open() is
  // scheduled on the libuv thread pool), so deleting the directory right
  // after a test can race an in-flight write/close and surface as an
  // unhandled ENOENT error attributed to an unrelated later test. Leaving
  // these small per-test temp dirs behind is harmless (OS temp cleanup).
});

/** Give any in-flight async fs writes (log stream flush) a chance to land on disk. */
function flushFs() {
  return new Promise((r) => setTimeout(r, 50));
}

describe("ProcessRunner construction", () => {
  it("creates the spool directory on construction", () => {
    const target = join(spoolDir, "nested", "spool");
    expect(existsSync(target)).toBe(false);

    new ProcessRunner("mock", makeMockLogger() as never, undefined, target);

    expect(existsSync(target)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("rejects when execute() is called without a mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);

    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked out",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options = baseOptions({ command: "mocked-cmd" });
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("mocked out");
    expect(logger.debug).toHaveBeenCalled();
  });

  it("never invokes node:child_process.spawn in mock mode", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    runner.setMockHandler(vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 0, timedOut: false }));

    await runner.execute(baseOptions());

    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner real mode: execute()", () => {
  it("resolves with stdout, stderr, exitCode, and timedOut:false on a clean exit", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: something"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn: something");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves (does not reject) with the non-zero exit code when the process fails normally", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.stderr.emit("data", Buffer.from("fatal error"));
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("fatal error");
  });

  it("defaults exitCode to 1 when close is emitted with a null code", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child's stdin and ends it when provided", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "prompt text" }));
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("ends stdin immediately without writing when no stdinData is given", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });

  it("rejects with the underlying error when the child process emits 'error'", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    const spawnError = new Error("ENOENT: no such file");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("ENOENT: no such file");
  });

  it("merges extra env vars on top of process.env when spawning", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ env: { CUSTOM_VAR: "value123" } }));
    child.emit("close", 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      "some-cli",
      ["--flag"],
      expect.objectContaining({
        env: expect.objectContaining({ CUSTOM_VAR: "value123" }),
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });
});

describe("ProcessRunner real mode: timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM after timeoutMs, then SIGKILL after a further grace period if still alive, and rejects with AgentTimeoutError", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1000 }));

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Process does not actually die (child.killed stays true from our mock's
    // own bookkeeping, but production code checks `!child.killed` — simulate
    // a process that ignores SIGTERM by resetting the flag).
    child.killed = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "some-cli", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not send SIGKILL if the child reports killed:true before the grace period elapses", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // child.killed was set to true by our mock's kill() implementation.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("clears the timeout and does not kill the process when it closes before the timeout fires", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 10_000 }));
    child.emit("close", 0);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner real mode: active-process tracking (context provided)", () => {
  it("tracks a running process in getActiveProcesses(), writes a manifest, and emits process:started", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "some-cli",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      "some-cli",
    );

    const manifestFiles = existsSync(join(spoolDir, `${active[0]!.id}.json`));
    expect(manifestFiles).toBe(true);

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("updates the manifest file on disk with completion details after close", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-2", stage: "planner", runtime: "codex" } }),
    );
    const [{ id: processId }] = runner.getActiveProcesses();
    child.emit("close", 3);
    await promise;

    const manifestPath = join(spoolDir, `${processId}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      exitCode: number;
      completedAt?: string;
    };
    expect(manifest.exitCode).toBe(3);
    expect(manifest.completedAt).toBeDefined();
  });

  it("does not track an active process or write a manifest when no context is given", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toHaveLength(0);
    child.emit("close", 0);
    await promise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns the live rolling buffer for an active process", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );
    const [{ id: processId }] = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("partial output so far"));

    expect(runner.getProcessOutput(processId)).toBe("partial output so far");

    child.emit("close", 0);
    await promise;
  });

  it("falls back to reading the on-disk log file once the process is no longer active", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );
    const [{ id: processId }] = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("logged to disk"));
    child.emit("close", 0);
    await promise;
    await flushFs();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(runner.getProcessOutput(processId)).toContain("logged to disk");
  });

  it("returns null when the process id is unknown and no log file exists", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("truncates the rolling buffer to the last 8KB of output", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );
    const [{ id: processId }] = runner.getActiveProcesses();

    const chunk = "a".repeat(2000);
    for (let i = 0; i < 6; i++) {
      child.stdout.emit("data", Buffer.from(chunk));
    }

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output!.length).toBeGreaterThan(0);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner: throttled process:output emission", () => {
  it("emits at most one process:output event within the throttle window, then another after it elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );

    child.stdout.emit("data", Buffer.from("chunk 1"));
    child.stdout.emit("data", Buffer.from("chunk 2"));
    child.stdout.emit("data", Buffer.from("chunk 3"));

    // First chunk should emit immediately (lastEmitMs starts at 0); the
    // following two land inside the 250ms throttle window.
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("chunk 4"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns without throwing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, join(spoolDir, "missing-subdir"));
    rmSync(join(spoolDir, "missing-subdir"), { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("does nothing when the spool directory has no manifest files", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    writeFileSync(
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 99999,
        command: "x",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeMockLogger();
    writeFileSync(
      join(spoolDir, "dead-proc.json"),
      JSON.stringify({
        id: "dead-proc",
        pid: 123456,
        command: "x",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-proc", pid: 123456 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(join(spoolDir, "dead-proc.json"), "utf-8")) as {
      crashed?: boolean;
      exitCode?: number;
      completedAt?: string;
    };
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();

    killSpy.mockRestore();
  });

  it("rehydrates a manifest whose pid is still alive into the active-process set and emits process:started", () => {
    // Use fake timers so the 5s liveness-polling interval started by
    // tailLogForOrphan() never actually fires against the real clock and
    // leak into later tests; afterEach() restores real timers, discarding it.
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const emitter = { emitProcessStarted: vi.fn(), emitProcessOutput: vi.fn(), emitProcessCompleted: vi.fn() };
    const logger = makeMockLogger();
    writeFileSync(
      join(spoolDir, "alive-proc.log"),
      "previously logged output that is retained on rehydration",
    );
    writeFileSync(
      join(spoolDir, "alive-proc.json"),
      JSON.stringify({
        id: "alive-proc",
        pid: process.pid,
        command: "claude",
        args: ["--print"],
        runId: "run-9",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "alive-proc.log"),
      }),
    );
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive-proc", runId: "run-9", stage: "executor" });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      "alive-proc",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getProcessOutput("alive-proc")).toContain("previously logged output");

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });
});
