import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessContext } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(actual.watch), readdirSync: vi.fn(actual.readdirSync) };
});

import { spawn } from "node:child_process";
import { watch, readdirSync } from "node:fs";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
  });
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("ProcessRunner (mock mode)", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "process-runner-mock-"));
  });

  it("throws when execute() is called in mock mode without a handler configured", async () => {
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
    runner.setMockHandler(vi.fn().mockResolvedValue(handlerResult));

    const result = await runner.execute(baseOptions());
    expect(result).toEqual(handlerResult);
  });
});

describe("ProcessRunner (real mode) — execute()", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let child: FakeChildProcess;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "process-runner-real-"));
    logger = makeLogger();
    emitter = makeEmitter();
    child = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
  });

  it("resolves with concatenated stdout/stderr and exitCode 0 on a clean exit", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());

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
  });

  it("resolves (does not reject) with a non-zero exitCode on a non-zero, non-timed-out exit", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());

    child.emit("close", 17);

    const result = await promise;
    expect(result.exitCode).toBe(17);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when close is emitted with a null code", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());

    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the raw error when the subprocess emits an 'error' event (e.g. ENOENT)", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());

    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    child.emit("error", enoent);

    await expect(promise).rejects.toThrow("spawn ENOENT");
  });

  it("writes stdinData to the child's stdin and ends it when provided", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions({ stdinData: "line1\n" }));

    expect(child.stdin.write).toHaveBeenCalledWith("line1\n");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const promise = runner.execute(baseOptions());

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("rejects with AgentTimeoutError and sends SIGTERM when the timeout elapses before close", async () => {
    vi.useFakeTimers();
    try {
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const promise = runner.execute(
        baseOptions({ timeoutMs: 100, context: { runId: "r1", stage: "executor", runtime: "claude-code" } }),
      );

      await vi.advanceTimersByTimeAsync(100);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      // Simulate the process actually exiting after being signaled.
      child.emit("close", null);

      await expect(promise).rejects.toThrow(AgentTimeoutError);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ command: "echo" }),
        "Process timed out",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates to SIGKILL if the process has not exited 5s after the SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      void runner.execute(baseOptions({ timeoutMs: 50 }));

      await vi.advanceTimersByTimeAsync(50); // trips the timeout -> SIGTERM
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.killed = false; // process ignored SIGTERM

      await vi.advanceTimersByTimeAsync(5_000); // escalation timer
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not escalate to SIGKILL if the process already reports killed=true", async () => {
    vi.useFakeTimers();
    try {
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      void runner.execute(baseOptions({ timeoutMs: 50 }));

      await vi.advanceTimersByTimeAsync(50);
      expect(child.killed).toBe(true); // our fake kill() sets this synchronously

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks the process in getActiveProcesses() while running, with correct shape", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute(baseOptions({ context }));

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "echo",
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith("r1", active[0]!.id, "executor", "claude-code", "echo");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("removes the process from getActiveProcesses() and emits completion on close", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute(baseOptions({ context }));
    const [{ id: processId }] = runner.getActiveProcesses();

    child.emit("close", 3);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r1",
      processId,
      "executor",
      "claude-code",
      3,
      expect.any(Number),
    );

    const manifestPath = join(spoolDir, `${processId}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(3);
  });

  it("getProcessOutput returns the live rolling buffer for an active process", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute(baseOptions({ context }));
    const [{ id: processId }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("partial output"));

    expect(runner.getProcessOutput(processId)).toBe("partial output");

    child.emit("close", 0);
    await promise;
  });

  it("getProcessOutput reads the tail of the on-disk log for a completed process", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute(baseOptions({ context }));
    const [{ id: processId }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("logged output"));
    child.emit("close", 0);
    await promise;
    // The write stream flushes to disk asynchronously after .end().
    await new Promise((resolve) => setTimeout(resolve, 20));

    // No longer active — must come from the log file on disk.
    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output).toContain("logged output");
  });

  it("getProcessOutput returns null when the process is neither active nor has a log file", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("truncates the rolling buffer to the last 8KB once it grows beyond that", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute(baseOptions({ context }));
    const [{ id: processId }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("a".repeat(5000)));
    child.stdout.emit("data", Buffer.from("b".repeat(5000)));

    const output = runner.getProcessOutput(processId)!;
    expect(output.length).toBe(8 * 1024);
    expect(output.endsWith("b")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("throttles emitProcessOutput so rapid-fire chunks within the throttle window only emit once", async () => {
    vi.useFakeTimers();
    try {
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const context: ProcessContext = { runId: "r1", stage: "executor", runtime: "claude-code" };
      const promise = runner.execute(baseOptions({ context }));

      child.stdout.emit("data", Buffer.from("chunk1"));
      child.stdout.emit("data", Buffer.from("chunk2"));
      child.stdout.emit("data", Buffer.from("chunk3"));

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(300); // past OUTPUT_THROTTLE_MS (250ms)
      child.stdout.emit("data", Buffer.from("chunk4"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

      child.emit("close", 0);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "process-runner-rehydrate-"));
    logger = makeLogger();
    emitter = makeEmitter();
  });

  it("does nothing when the spool directory has no manifest files", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("returns silently when readdirSync throws", () => {
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw new Error("ENOENT: spool dir missing");
    });
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have a completedAt", () => {
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({ id: "done", pid: 1, command: "x", args: [], runId: "r", stage: "s", runtime: "claude-code", startedAt: new Date().toISOString(), logFile: "x", completedAt: new Date().toISOString() }),
    );
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("marks a manifest crashed (and rewrites it) when its pid is no longer alive", () => {
    const manifestPath = join(spoolDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 999_999_999, // astronomically unlikely to be a live pid
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: "x",
      }),
    );
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
      crashed?: boolean;
    };
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 999_999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
  });

  it("rehydrates a manifest whose pid is alive: registers it active and emits process:started", () => {
    const logPath = join(spoolDir, "alive.log");
    writeFileSync(logPath, "previous output\n");
    const manifestPath = join(spoolDir, "alive.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive",
        pid: process.pid, // this test process is definitely alive
        command: "x",
        args: [],
        runId: "r1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let capturedWatchCb: (() => void) | undefined;
    vi.mocked(watch).mockImplementationOnce((_path, cb) => {
      capturedWatchCb = cb as () => void;
      return { close: vi.fn() } as never;
    });

    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith("r1", "alive", "executor", "claude-code", "x");
    expect(runner.getActiveProcesses().map((p) => p.id)).toContain("alive");
    expect(runner.getProcessOutput("alive")).toBe("previous output\n");
    expect(watch).toHaveBeenCalled();
    expect(capturedWatchCb).toBeDefined();
  });

  it("appends newly-written log content to the rolling buffer when the watched log file grows", () => {
    const logPath = join(spoolDir, "alive2.log");
    writeFileSync(logPath, "start\n");
    writeFileSync(
      join(spoolDir, "alive2.json"),
      JSON.stringify({
        id: "alive2",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "r1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let capturedWatchCb: (() => void) | undefined;
    vi.mocked(watch).mockImplementationOnce((_path, cb) => {
      capturedWatchCb = cb as () => void;
      return { close: vi.fn() } as never;
    });

    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    runner.rehydrateOrphans();

    // Simulate the file growing, then fire the fs.watch callback.
    writeFileSync(logPath, "start\nmore output");
    capturedWatchCb!();

    expect(runner.getProcessOutput("alive2")).toBe("start\nmore output");
  });

  it("finalizes an orphan (removes it, updates the manifest, emits completion) once its pid is detected dead", async () => {
    vi.useFakeTimers();
    try {
      const logPath = join(spoolDir, "alive3.log");
      writeFileSync(logPath, "x");
      const manifestPath = join(spoolDir, "alive3.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "alive3",
          pid: process.pid,
          command: "x",
          args: [],
          runId: "r1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      vi.mocked(watch).mockImplementationOnce(() => ({ close: vi.fn() }) as never);
      // First call is rehydrateOrphans' own initial liveness check (must report alive so
      // the orphan gets registered); every call after that is the poll-interval's repeated
      // liveness check, which we want to report dead to trigger finalization.
      let killCalls = 0;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        killCalls += 1;
        if (killCalls === 1) return true;
        throw new Error("ESRCH");
      });

      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses().map((p) => p.id)).toContain("alive3");

      await vi.advanceTimersByTimeAsync(5_000); // the death-detection poll interval

      expect(runner.getActiveProcesses().map((p) => p.id)).not.toContain("alive3");
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "r1",
        "alive3",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { exitCode?: number };
      expect(manifest.exitCode).toBe(-1);

      killSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
