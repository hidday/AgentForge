import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessCompleted: vi.fn(),
    emitProcessOutput: vi.fn(),
  };
}

class FakeChildProcess extends EventEmitter {
  pid = 4321;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * The log file is opened by a real (unmocked) fs.WriteStream, whose underlying
 * open() is asynchronous. Under load (e.g. other test files running in
 * parallel) it can take a little longer than a single microtask tick to
 * appear on disk, so poll for it instead of asserting immediately.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  vi.mocked(spawn).mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  // Log writes go through a real fs.WriteStream opened asynchronously; give any
  // in-flight open/write/close a moment to settle before the spool dir is removed,
  // otherwise a delayed open can surface as an unhandled ENOENT after the test ends.
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner (mock mode)", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result without touching child_process", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const mockResult: ProcessResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const result = await runner.execute({ command: "x", args: ["a"], cwd: "/tmp", timeoutMs: 1000 });

    expect(result).toBe(mockResult);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "x", args: ["a"], cwd: "/tmp" }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner (real mode) — basic execution", () => {
  it("resolves with captured stdout, stderr and exit code 0 on a clean close", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 5000 });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("resolves (does not reject) with a non-zero exit code on normal exit", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("defaults the exit code to 1 when the child reports a null exit code", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child process and ends stdin", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "prompt text",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing anything when no stdinData is given", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "cat", args: [], cwd: "/tmp", timeoutMs: 5000 });

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("rejects when the child process emits an 'error' event (e.g. ENOENT)", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "nonexistent", args: [], cwd: "/tmp", timeoutMs: 5000 });
    const err = new Error("spawn nonexistent ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("merges extraEnv on top of process.env and passes cwd through to spawn", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/some/dir",
      timeoutMs: 5000,
      env: { MY_VAR: "my-value" },
    });

    expect(spawn).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/some/dir",
        env: expect.objectContaining({ MY_VAR: "my-value" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner (real mode) — timeout and kill escalation", () => {
  it("sends SIGTERM when the timeout elapses and rejects with AgentTimeoutError once the process closes", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("escalates to SIGKILL after the 5s grace period when SIGTERM does not stop the process", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    child.kill = vi.fn(); // no side effect: `killed` stays false, simulating an unresponsive process
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when SIGTERM succeeds within the grace period", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess(); // default kill() sets killed = true
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "sleep", args: ["100"], cwd: "/tmp", timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.mocked(child.kill).mockClear();

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("includes the runtime/stage label in the AgentTimeoutError when context is provided", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/tmp",
      timeoutMs: 10,
      context: { runId: "run-x", stage: "executor", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(10);
    child.emit("close", null);

    await expect(promise).rejects.toThrow(/claude-code\/executor/);
  });
});

describe("ProcessRunner (real mode) — active process tracking, manifests and events", () => {
  it("tracks an active process, writes a manifest + log file, and emits start/complete events", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-9", stage: "executor", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "echo",
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      active[0]!.id,
      "executor",
      "claude-code",
      "echo",
    );

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({ pid: child.pid, command: "echo", runId: "run-9" });
    expect(manifest.completedAt).toBeUndefined();

    child.stdout.emit("data", Buffer.from("hi\n"));
    child.emit("close", 0);
    await promise;
    await flushMicrotasks();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updatedManifest.exitCode).toBe(0);
    expect(typeof updatedManifest.completedAt).toBe("string");

    const logPath = join(spoolDir, `${active[0]!.id}.log`);
    await waitFor(() => existsSync(logPath));
    expect(existsSync(logPath)).toBe(true);
  });

  it("throttles process:output emission on rapid successive chunks but always updates the rolling buffer", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-10", stage: "planner", runtime: "codex" },
    });
    const [{ id: processId }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("chunk-1"));
    child.stdout.emit("data", Buffer.from("chunk-2"));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(runner.getProcessOutput(processId)).toBe("chunk-1chunk-2");

    child.emit("close", 0);
    await promise;
  });

  it("truncates the in-memory rolling output buffer to the last ROLLING_BUFFER_MAX characters", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-11", stage: "planner", runtime: "codex" },
    });
    const [{ id: processId }] = runner.getActiveProcesses();

    const big = "A".repeat(9000);
    child.stdout.emit("data", Buffer.from(big));

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toBe(big.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("does not create a tracked active process or manifest when no context is given", async () => {
    const child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 5000 });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null for a processId that was never seen", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads the tail of the on-disk log file once the process is no longer active", () => {
    const processId = "finished-proc";
    writeFileSync(join(spoolDir, `${processId}.log`), "line one\nline two\n");
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput(processId)).toBe("line one\nline two\n");
  });

  it("returns null when the log file exists but cannot be read as text (e.g. is a directory)", () => {
    const processId = "unreadable";
    mkdirSync(join(spoolDir, `${processId}.log`));
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput(processId)).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("does nothing and does not throw when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    const manifestPath = join(spoolDir, "done.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "echo",
        args: [],
        runId: "run-done",
        stage: "planner",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a dead orphaned process (unreachable pid) as crashed in its manifest", () => {
    const manifestId = "proc-dead";
    const manifestPath = join(spoolDir, `${manifestId}.json`);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: manifestId,
        pid: 999998,
        command: "echo",
        args: [],
        runId: "run-2",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, `${manifestId}.log`),
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: manifestId, pid: 999998 }),
      "Orphaned agent process is dead, marking crashed",
    );

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(typeof updated.completedAt).toBe("string");
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file contains malformed JSON", () => {
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphaned process, tracks it as active, and finalizes it once it disappears", async () => {
    vi.useFakeTimers();
    const manifestId = "proc-alive";
    const logPath = join(spoolDir, `${manifestId}.log`);
    writeFileSync(logPath, "hello\n");
    writeFileSync(
      join(spoolDir, `${manifestId}.json`),
      JSON.stringify({
        id: manifestId,
        pid: 999999,
        command: "echo",
        args: [],
        runId: "run-1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: manifestId, pid: 999999 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      manifestId,
      "planner",
      "claude-code",
      "echo",
    );
    expect(runner.getActiveProcesses().map((p) => p.id)).toContain(manifestId);

    // Simulate the process disappearing: the next liveness poll should finalize it.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      manifestId,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses().map((p) => p.id)).not.toContain(manifestId);

    killSpy.mockRestore();
  });
});
