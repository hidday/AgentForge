import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

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
});
