import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid: number;
  killed = false;
  kill = vi.fn();

  constructor(pid = 4321) {
    super();
    this.pid = pid;
  }
}

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

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
  spawnMock.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // ProcessRunner opens log files via createWriteStream, whose underlying
  // fs.open() completes asynchronously. Give any in-flight opens a chance to
  // settle before removing their target directory, otherwise a late open can
  // fire an unhandled ENOENT after the directory is already gone.
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when execute() is called without a mock handler configured", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
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

    const options: ProcessSpawnOptions = {
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("mocked");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner — real mode: successful execution", () => {
  it("captures interleaved stdout/stderr and resolves with exit code 0", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "echo",
      args: ["hello"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("a warning"));
    child.emit("close", 0);

    const result = await resultPromise;

    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("a warning");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(child.stdin.end).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("writes stdinData to the child process then ends stdin", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "input payload",
    });

    child.emit("close", 0);
    await resultPromise;

    expect(child.stdin.write).toHaveBeenCalledWith("input payload");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("resolves with a non-zero exit code without throwing", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 3);

    const result = await resultPromise;
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({ command: "killed", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the underlying error when the child process emits 'error' (e.g. spawn ENOENT)", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "does-not-exist",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    const spawnError = Object.assign(new Error("spawn does-not-exist ENOENT"), { code: "ENOENT" });
    child.emit("error", spawnError);

    await expect(resultPromise).rejects.toBe(spawnError);
  });
});

describe("ProcessRunner — real mode: timeout handling", () => {
  it("sends SIGTERM once the timeout elapses and rejects with AgentTimeoutError on close", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "sleep",
      args: ["999"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await assertion;

    const rejection = await resultPromise.catch((e: unknown) => e as AgentTimeoutError);
    expect(rejection.timeoutMs).toBe(1000);
    expect(rejection.agent).toBe("sleep");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "sleep", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("uses '<runtime>/<stage>' as the timeout label when a context is provided", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 500,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);
    await assertion;

    const rejection = await resultPromise.catch((e: unknown) => e as AgentTimeoutError);
    expect(rejection.agent).toBe("claude-code/planner");
  });

  it("escalates to SIGKILL if the process has not exited 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "sleep",
      args: ["999"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await assertion;
  });

  it("does not escalate to SIGKILL when the process already exited after SIGTERM", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    child.kill.mockImplementation(() => {
      child.killed = true;
    });
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "sleep",
      args: ["999"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1); // no SIGKILL escalation

    child.emit("close", null);
    await assertion;
  });

  it("clears the timeout on a normal close so it never fires after the process exits in time", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "quick",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });

    child.emit("close", 0);
    const result = await resultPromise;
    expect(result.timedOut).toBe(false);

    // advancing well past the timeout must not retroactively kill anything
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — real mode: process tracking with context", () => {
  it("writes a manifest, tracks the active process, and emits started/completed dashboard events", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess(9999);
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 9999,
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude",
    });
    const processId = active[0]!.id;
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${processId}.json`);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestBefore).toMatchObject({
      pid: 9999,
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
      command: "claude",
    });
    expect(manifestBefore.completedAt).toBeUndefined();

    child.stdout.emit("data", Buffer.from("v1.2.3"));
    child.emit("close", 0);
    await resultPromise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifestAfter.completedAt).toEqual(expect.any(String));
    expect(manifestAfter.exitCode).toBe(0);
    expect(manifestAfter.durationMs).toEqual(expect.any(Number));
  });

  it("does not track an active process or write a manifest when no context is provided", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await resultPromise;
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("marks the process crashed with exit code -1 when the child errors out mid-run with a context", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess(555);
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-9", stage: "executor", runtime: "claude-code" },
    });
    const processId = runner.getActiveProcesses()[0]!.id;

    const spawnError = new Error("EACCES");
    child.emit("error", spawnError);
    await expect(resultPromise).rejects.toBe(spawnError);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("getProcessOutput returns the live rolling buffer for an active process", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const resultPromise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("progress line 1\n"));

    expect(runner.getProcessOutput(processId)).toContain("progress line 1");

    child.emit("close", 0);
    await resultPromise;
  });

  it("returns null from getProcessOutput for an unknown process id with no log file on disk", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("falls back to reading the on-disk log file when the process is no longer active", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "past-process.log"), "line one\nline two\n");

    expect(runner.getProcessOutput("past-process")).toBe("line one\nline two\n");
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns without throwing when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "x",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
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

  it("marks a manifest as crashed on disk when its process is no longer alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 999_999_999,
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
      expect.objectContaining({ processId: "dead", pid: 999_999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toEqual(expect.any(String));
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file is not valid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("ignores non-.json files in the spool directory", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "some-process.log"), "just a log file, not a manifest");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rehydrates a live orphan, tracks it, and finalizes it once the process disappears", async () => {
    vi.useFakeTimers();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "orphan1.log");
    writeFileSync(logPath, "previous output\n");
    const manifestPath = join(spoolDir, "orphan1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "orphan1",
        pid: 55555,
        command: "claude",
        args: [],
        runId: "run-x",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      killCalls += 1;
      if (killCalls === 1) return true; // rehydrateOrphans' initial liveness check
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); // pollInterval sees it gone
    });

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan1", pid: 55555, stage: "planner" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-x",
      "orphan1",
      "planner",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("orphan1")).toContain("previous output");

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-x",
      "orphan1",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan1", pid: 55555 }),
      "Orphaned process has exited",
    );

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toEqual(expect.any(String));
    expect(finalManifest.exitCode).toBe(-1);

    killSpy.mockRestore();
  });
});
