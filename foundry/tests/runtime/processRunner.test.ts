import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// processRunner.ts spawns real OS subprocesses via node:child_process's `spawn`
// and watches orphaned processes' log files via node:fs's `watch`. Neither may
// run for real in tests: `spawn` is fully replaced with a controllable fake
// child process, and `watch` is replaced with a no-op fake watcher so no real
// OS-level file watcher or subprocess is ever created. All other fs calls
// (mkdirSync, writeFileSync, readFileSync, readdirSync, createWriteStream,
// existsSync) are the real implementations, operating on a throwaway temp
// directory created per test.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const watchMock = vi.fn();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: (...args: unknown[]) => watchMock(...args),
  };
});

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");
const { AgentTimeoutError } = await import("../../src/utils/errors.js");

class FakeChildProcess extends EventEmitter {
  pid: number | undefined = 4321;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
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
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  spawnMock.mockReset();
  watchMock.mockReset();
  watchMock.mockReturnValue({ close: vi.fn() });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // `createWriteStream` opens its file descriptor asynchronously. Give any
  // writer started during the test a tick to finish opening/closing before
  // the spool directory is removed, so a late open doesn't fail against an
  // already-deleted directory and surface as an unhandled stream error.
  await new Promise((r) => setTimeout(r, 20));
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("ProcessRunner — mock mode", () => {
  it("throws when execute() is called with no mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 100 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 100,
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: "echo", args: ["hi"] }));
    expect(result.stdout).toBe("ok");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — real mode, successful execution", () => {
  it("spawns the subprocess, collects stdout/stderr, and resolves on close", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(child.stdin.end).toHaveBeenCalled();

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
  });

  it("writes stdinData to the child process before ending stdin", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

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

  it("merges extra env vars on top of process.env", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { MY_VAR: "my-value" },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      [],
      expect.objectContaining({ env: expect.objectContaining({ MY_VAR: "my-value" }) }),
    );

    child.emit("close", 0);
    await promise;
  });

  it("treats a null exit code as exitCode 1", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });
});

describe("ProcessRunner — real mode, process tracking with context", () => {
  it("registers the process as active, writes a manifest, and emits started/completed events", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4321,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0].id).toBe("string");
    expect(active[0].elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "planner",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${active[0].id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
    };
    expect(manifestBefore.completedAt).toBeUndefined();

    // While active, process output is served from the in-memory rolling buffer.
    child.stdout.emit("data", Buffer.from("thinking..."));
    expect(runner.getProcessOutput(active[0].id)).toBe("thinking...");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "planner",
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

  it("caps the rolling output buffer at 8KB and keeps only the tail", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "noisy",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "codex" },
    });

    const [{ id }] = runner.getActiveProcesses();
    const bigChunk = "x".repeat(10_000);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(id);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output!.endsWith("x")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output events to at most one per 250ms and truncates long chunks to 500 chars", async () => {
    vi.useFakeTimers();
    try {
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);

      const promise = runner.execute({
        command: "noisy",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context: { runId: "run-1", stage: "executor", runtime: "codex" },
      });

      // First chunk emits immediately (lastEmitMs starts at 0).
      child.stdout.emit("data", Buffer.from("x".repeat(600)));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      const [, , firstChunk] = emitter.emitProcessOutput.mock.calls[0];
      expect(firstChunk.length).toBe(500);

      // A second chunk arriving immediately after is throttled (no new emit).
      child.stdout.emit("data", Buffer.from("more data"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      // After the throttle window elapses, the next chunk is emitted.
      vi.advanceTimersByTime(250);
      child.stdout.emit("data", Buffer.from("later data"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

      child.emit("close", 0);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null output for an unknown process id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads completed process output from its spooled log file on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "finished-proc.log"), "archived log contents");

    expect(runner.getProcessOutput("finished-proc")).toBe("archived log contents");
  });
});

describe("ProcessRunner — real mode, timeout handling", () => {
  it("rejects with AgentTimeoutError and kills the child after the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = new FakeChildProcess();
      spawnMock.mockReturnValue(child);

      const promise = runner.execute({
        command: "slow",
        args: [],
        cwd: "/tmp",
        timeoutMs: 1000,
        context: { runId: "run-1", stage: "executor", runtime: "codex" },
      });
      const rejection = expect(promise).rejects.toThrow(AgentTimeoutError);

      vi.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      // Simulate the child actually exiting once signalled.
      child.emit("close", null);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to SIGKILL if the child has not exited 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const child = new FakeChildProcess();
      // Simulate a child that ignores SIGTERM (killed flag never flips).
      child.kill = vi.fn();
      spawnMock.mockReturnValue(child);

      const promise = runner.execute({ command: "stuck", args: [], cwd: "/tmp", timeoutMs: 1000 });
      const rejection = expect(promise).rejects.toThrow(AgentTimeoutError);

      vi.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

      vi.advanceTimersByTime(5000);
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

      child.emit("close", null);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProcessRunner — real mode, spawn error handling", () => {
  it("rejects with the spawn error and cleans up the tracked process", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "missing-binary",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "codex" },
    });

    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn ENOENT");
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      "executor",
      "codex",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner — rehydrateOrphans", () => {
  it("does nothing when the spool directory cannot be read", () => {
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
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 99999,
        command: "x",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("marks an orphaned manifest crashed when its process is no longer alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    const manifestPath = join(spoolDir, "dead-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: 99999,
        command: "x",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

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
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("rehydrates an orphan whose process is still alive, registering it as active", () => {
    vi.useFakeTimers();
    try {
      const logger = makeMockLogger();
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

      writeFileSync(
        join(spoolDir, "alive-proc.json"),
        JSON.stringify({
          id: "alive-proc",
          pid: 55555,
          command: "claude",
          args: ["--print"],
          runId: "run-1",
          stage: "planner",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "alive-proc.log"),
        }),
      );

      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-proc", pid: 55555 }),
        "Rehydrating orphaned agent process",
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        "alive-proc",
        "planner",
        "claude-code",
        "claude",
      );
      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive-proc", pid: 55555 });
      // tailLogForOrphan watches the (mocked) log file rather than a real fs watcher.
      expect(watchMock).toHaveBeenCalled();

      killSpy.mockRestore();
    } finally {
      // Any interval scheduled against the fake clock is discarded here
      // rather than left running as a real OS timer.
      vi.useRealTimers();
    }
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt-proc.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt-proc.json" }),
      "Failed to process manifest",
    );
  });
});
