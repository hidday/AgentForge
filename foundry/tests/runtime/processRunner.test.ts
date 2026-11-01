import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 10): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
});

afterEach(() => {
  rmSync(spoolDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory if it does not already exist", () => {
    const nested = join(spoolDir, "nested", "deep");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("mock", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("delegates execute() to the configured mock handler", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "whatever",
      args: ["x"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("mocked");
  });

  it("throws when mock mode is enabled but no handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner real mode — basic exec outcomes", () => {
  it("resolves with stdout, exitCode 0 and timedOut false on a clean exit", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello-world'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures a non-zero exit code and stderr output", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stderr.write('boom'); process.exit(3)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");
  });

  it("writes stdinData to the child process and the child can read it", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: [
        "-e",
        "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{process.stdout.write('echo:'+d); process.exit(0)})",
      ],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdinData: "abc123",
    });

    expect(result.stdout).toBe("echo:abc123");
  });

  it("rejects with the spawn error when the command does not exist", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({
        command: "this-command-does-not-exist-xyz-123",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });

  it("rejects with AgentTimeoutError and kills the child when the timeout elapses", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
        cwd: process.cwd(),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(AgentTimeoutError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 100 }),
      "Process timed out",
    );
  }, 10000);
});

describe("ProcessRunner real mode — process tracking, manifests, and emitter calls", () => {
  it("tracks an active process (manifest + emitter) while it runs, then removes it on completion", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const execPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => { process.stdout.write('done'); process.exit(0); }, 150)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-abc", stage: "executor", runtime: "claude-code" },
    });

    await waitFor(() => runner.getActiveProcesses().length > 0);
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ runId: "run-abc", stage: "executor", runtime: "claude-code" });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-abc",
      active[0]!.id,
      "executor",
      "claude-code",
      process.execPath,
    );

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.runId).toBe("run-abc");
    expect(manifest.completedAt).toBeUndefined();

    const result = await execPromise;
    expect(result.exitCode).toBe(0);
    expect(runner.getActiveProcesses()).toHaveLength(0);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-abc",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(0);
  });

  it("getProcessOutput returns the live rolling buffer for an active process and null for an unknown id", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("no-such-process")).toBeNull();

    const execPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('live-chunk'); setTimeout(() => process.exit(0), 150)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-live", stage: "planner", runtime: "claude-code" },
    });

    await waitFor(() => runner.getActiveProcesses().length > 0);
    const id = runner.getActiveProcesses()[0]!.id;
    await waitFor(() => (runner.getProcessOutput(id) ?? "").includes("live-chunk"));
    expect(runner.getProcessOutput(id)).toContain("live-chunk");

    await execPromise;
  });

  it("getProcessOutput falls back to reading the log file (tail) once the process has completed", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const id = await (async () => {
      const execPromise = runner.execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write('from-log-file'); process.exit(0)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-log", stage: "planner", runtime: "claude-code" },
      });
      await waitFor(() => runner.getActiveProcesses().length > 0);
      const procId = runner.getActiveProcesses()[0]!.id;
      await execPromise;
      return procId;
    })();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    const output = runner.getProcessOutput(id);
    expect(output).toContain("from-log-file");
  });

  it("getProcessOutput returns null when no log file exists for a given id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("never-ran")).toBeNull();
  });

  it("throttles process:output emits and truncates very long chunks to the last 500 chars", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const bigChunk = "Y".repeat(1000) + "[END]";
    const execPromise = runner.execute({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(bigChunk)}); process.exit(0)`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-big", stage: "executor", runtime: "claude-code" },
    });

    await execPromise;

    expect(emitter.emitProcessOutput).toHaveBeenCalled();
    const [, , chunkArg] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((chunkArg as string).length).toBeLessThanOrEqual(500);
    expect(chunkArg).toContain("[END]");
  });

  it("trims the rolling buffer to the max size when accumulated output grows very large", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    // 9KB of output — exceeds the 8KB ROLLING_BUFFER_MAX, ending in a marker.
    const hugeOutput = "Z".repeat(9 * 1024) + "[TAIL]";
    const execPromise = runner.execute({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(hugeOutput)}); process.exit(0)`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-huge", stage: "executor", runtime: "claude-code" },
    });

    const id = await (async () => {
      await waitFor(() => runner.getActiveProcesses().length > 0);
      return runner.getActiveProcesses()[0]!.id;
    })();
    await execPromise;

    const output = runner.getProcessOutput(id);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toContain("[TAIL]");
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("does nothing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 999999,
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "dead.json");
    // PID extremely unlikely to exist on any system.
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid: 2_000_000_000,
        command: "x",
        args: [],
        runId: "r-dead",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid: 2_000_000_000 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates a manifest whose pid is alive, registers it as active, and tails its log file", async () => {
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive.log");
    writeFileSync(logPath, "initial-content");
    const manifestPath = join(spoolDir, "alive.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive",
        pid: process.pid,
        command: "some-cmd",
        args: [],
        runId: "r-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: process.pid, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "r-alive",
      "alive",
      "executor",
      "claude-code",
      "some-cmd",
    );
    expect(runner.getActiveProcesses().map((p) => p.id)).toContain("alive");
    expect(runner.getProcessOutput("alive")).toBe("initial-content");

    // tailLogForOrphan() watches the log file for growth; verify it picks up
    // an appended chunk. The watcher/interval it creates are not exposed by
    // the class, so we leave them running — they're reaped when this test
    // worker process tears down at the end of the file.
    appendFileSync(logPath, "-appended");
    await waitFor(() => (runner.getProcessOutput("alive") ?? "").includes("appended"), 3000, 20);
    expect(runner.getProcessOutput("alive")).toContain("initial-content-appended");
  }, 10000);

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
  });

  it("ignores non-.json files in the spool directory", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates an alive pid even when its log file does not exist yet (no-log-file branch)", () => {
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-nolog.log");
    writeFileSync(
      join(spoolDir, "alive-nolog.json"),
      JSON.stringify({
        id: "alive-nolog",
        pid: process.pid,
        command: "some-cmd",
        args: [],
        runId: "r-nolog",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    // tailLogForOrphan() calls fs.watch() on a path that doesn't exist, which
    // throws synchronously and is caught by the outer per-manifest handler —
    // but the entry is registered as active before that happens.
    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses().map((p) => p.id)).toContain("alive-nolog");
    expect(runner.getProcessOutput("alive-nolog")).toBe("");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "r-nolog",
      "alive-nolog",
      "executor",
      "claude-code",
      "some-cmd",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "alive-nolog.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
  });
});

describe("ProcessRunner — tailLogForOrphan watch-callback stale-entry branch", () => {
  it("closes the watcher and no-ops when the entry was already removed before a watch event fires", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const logPath = join(spoolDir, "stale.log");
    writeFileSync(logPath, "seed");
    writeFileSync(
      join(spoolDir, "stale.json"),
      JSON.stringify({
        id: "stale",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "r-stale",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses().map((p) => p.id)).toContain("stale");

    // Simulate the entry being cleaned up elsewhere (e.g. by finalizeOrphan)
    // while the fs.watch() callback is still attached to the log file.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete("stale");

    expect(() => appendFileSync(logPath, "-more")).not.toThrow();
    await waitFor(() => !existsSync(join(spoolDir, "stale.json")) || true, 300, 50).catch(() => {});

    // No active entry remains, and output now falls back to the log file on disk.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(runner.getProcessOutput("stale")).toContain("seed");
  });
});

describe("ProcessRunner.finalizeOrphan (invoked directly — the only deterministic way to exercise the 5s interval's dead-process branch without a real 5s wait)", () => {
  function castRunner(runner: ProcessRunner) {
    return runner as unknown as {
      activeProcesses: Map<string, {
        id: string;
        pid: number;
        command: string;
        context: { runId: string; stage: string; runtime: string };
        startedAt: Date;
        rollingBuffer: string;
        logStream: { end: () => void } | null;
        lastEmitMs: number;
      }>;
      finalizeOrphan(id: string): void;
    };
  }

  it("removes the entry, finalizes the manifest, and emits process:completed with exitCode -1", () => {
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const internal = castRunner(runner);

    const manifestPath = join(spoolDir, "orphan-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "orphan-1",
        pid: 4242,
        command: "x",
        args: [],
        runId: "r-orphan",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-1.log"),
      }),
    );
    internal.activeProcesses.set("orphan-1", {
      id: "orphan-1",
      pid: 4242,
      command: "x",
      context: { runId: "r-orphan", stage: "executor", runtime: "claude-code" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
    });

    internal.finalizeOrphan("orphan-1");

    expect(internal.activeProcesses.has("orphan-1")).toBe(false);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(-1);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r-orphan",
      "orphan-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { processId: "orphan-1", pid: 4242 },
      "Orphaned process has exited",
    );
  });

  it("is a no-op when the entry is no longer tracked", () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const internal = castRunner(runner);

    expect(() => internal.finalizeOrphan("does-not-exist")).not.toThrow();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("still removes the entry and emits process:completed even when the manifest file is missing on disk", () => {
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const internal = castRunner(runner);

    internal.activeProcesses.set("orphan-2", {
      id: "orphan-2",
      pid: 4243,
      command: "x",
      context: { runId: "r-orphan-2", stage: "planner", runtime: "codex" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
    });

    expect(() => internal.finalizeOrphan("orphan-2")).not.toThrow();
    expect(internal.activeProcesses.has("orphan-2")).toBe(false);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r-orphan-2",
      "orphan-2",
      "planner",
      "codex",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner real mode — double-kill safety net and best-effort manifest writes", () => {
  it("falls back to SIGKILL when the child is not marked killed after the SIGTERM grace period", async () => {
    vi.useFakeTimers();
    try {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const fakeChild = Object.assign(new EventEmitter(), {
        pid: 55555,
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout,
        stderr,
        killed: false,
        kill: vi.fn(),
      });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fakeChild);

      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const resultPromise = runner.execute({
        command: "x",
        args: [],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(fakeChild.kill).not.toHaveBeenCalledWith("SIGKILL");

      // Child never actually dies (killed stays false) — the 5s grace-period
      // fallback should now send SIGKILL.
      await vi.advanceTimersByTimeAsync(5000);
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGKILL");

      fakeChild.emit("close", null);
      await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send SIGKILL when the child is already marked killed within the grace period", async () => {
    vi.useFakeTimers();
    try {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const fakeChild = Object.assign(new EventEmitter(), {
        pid: 55556,
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout,
        stderr,
        killed: false,
        kill: vi.fn(() => {
          fakeChild.killed = true;
        }),
      });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fakeChild);

      const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
      const resultPromise = runner.execute({
        command: "x",
        args: [],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(5000);
      expect(fakeChild.kill).not.toHaveBeenCalledWith("SIGKILL");

      fakeChild.emit("close", null);
      await expect(resultPromise).rejects.toThrow(AgentTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes successfully even when the process manifest disappears before the child exits (best-effort write)", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const execPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 150)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-vanish", stage: "executor", runtime: "claude-code" },
    });

    await waitFor(() => runner.getActiveProcesses().length > 0);
    const id = runner.getActiveProcesses()[0]!.id;
    rmSync(join(spoolDir, `${id}.json`), { force: true });

    const result = await execPromise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-vanish",
      id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });
});
