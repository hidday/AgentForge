import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

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

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
});

afterEach(() => {
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when mock mode is enabled but no handler is configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow(/Mock mode enabled but no mock handler configured/);
  });

  it("delegates to the configured mock handler and logs the call", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mock-out",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "fake",
      args: ["--flag"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(result.stdout).toBe("mock-out");
    expect(handler).toHaveBeenCalledWith(options);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake", args: ["--flag"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner — real mode, basic spawning", () => {
  it("resolves with stdout/stderr/exitCode for a successful process", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello-out'); process.stderr.write('hello-err');"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello-out");
    expect(result.stderr).toBe("hello-err");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with a non-zero exit code when the process exits with failure", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.exit(3);"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(3);
  });

  it("writes stdinData to the child process's stdin", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: [
        "-e",
        "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>process.stdout.write('got:'+d));",
      ],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "piped-input",
    });

    expect(result.stdout).toBe("got:piped-input");
  });

  it("merges extra env vars into the spawned process environment", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.FOUNDRY_TEST_VAR || '')"],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { FOUNDRY_TEST_VAR: "custom-value" },
    });

    expect(result.stdout).toBe("custom-value");
  });

  it("rejects with AgentTimeoutError when the process exceeds timeoutMs", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10000);"],
        cwd: "/tmp",
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out|timeout/i);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 200 }),
      "Process timed out",
    );
  });

  it("rejects when the command cannot be spawned (ENOENT), cleaning up the tracked process", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    await expect(
      runner.execute({
        command: "this-command-definitely-does-not-exist-xyz",
        args: [],
        cwd: "/tmp",
        timeoutMs: 2000,
        context: { runId: "run-enoent", stage: "executor", runtime: "codex" },
      }),
    ).rejects.toThrow();

    // cleanupProcess ran for the spawn-error path too (exitCode -1).
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-enoent",
      expect.any(String),
      "executor",
      "codex",
      -1,
      expect.any(Number),
    );
  });

  it("defaults the spool directory to .foundry/processes under the cwd when none is given", () => {
    const defaultDir = join(process.cwd(), ".foundry", "processes");
    rmSync(defaultDir, { recursive: true, force: true });
    try {
      new ProcessRunner("real", makeLogger() as never);
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      rmSync(join(process.cwd(), ".foundry"), { recursive: true, force: true });
    }
  });

  it("exits via code ?? 1 fallback when the child is terminated by its own signal (code is null)", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.kill(process.pid, 'SIGTERM');"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    // Terminated by its own signal, not by our timeout path: close fires
    // with code === null, exercising the `code ?? 1` fallback.
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("rejects with AgentTimeoutError (including the context-based label) when a process times out", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    // NOTE: the nested SIGKILL-escalation setTimeout (`if (!child.killed)`)
    // in executeReal appears unreachable in practice: Node's
    // `subprocess.killed` is set to true as soon as `kill()` successfully
    // *sends* SIGTERM, not once the process has actually exited (see the
    // Node docs for ChildProcess#killed). So for a process that ignores
    // SIGTERM, this guard is always false and SIGKILL is never sent — the
    // process hangs instead of being force-killed. That looks like a real
    // latent bug worth a human fix; it is not exercised here because
    // reproducing it deterministically would require a test process that
    // hangs for the lifetime of the run (no bounded way to assert on it).
    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 20000);"],
        cwd: "/tmp",
        timeoutMs: 100,
        context: { runId: "run-timeout-ctx", stage: "executor", runtime: "codex" },
      }),
    ).rejects.toThrow(/timed out|timeout/i);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 100 }),
      "Process timed out",
    );
  });
});

describe("ProcessRunner — context tracking, active processes, and output", () => {
  it("tracks an active process while a context is provided, then clears it on completion", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('chunk-data'); setTimeout(() => {}, 150);"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    await new Promise((r) => setTimeout(r, 60));
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      process.execPath,
    );

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

  it("returns the rolling buffer for an active process via getProcessOutput", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('live-output'); setTimeout(() => {}, 150);"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "codex" },
    });

    await new Promise((r) => setTimeout(r, 60));
    const active = runner.getActiveProcesses();
    const output = runner.getProcessOutput(active[0]!.id);
    expect(output).toContain("live-output");

    await promise;
  });

  it("falls back to reading the spooled log file for a completed process's output", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('finished-output');"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "executor", runtime: "cursor" },
    });

    const files = readdirSync(spoolDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(spoolDir, files[0]!), "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);

    const output = runner.getProcessOutput(manifest.id);
    expect(output).toContain("finished-output");
  });

  it("returns null from getProcessOutput for an unknown process id with no log file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("returns null from getProcessOutput when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // A directory at the expected log path exists, but readFileSync on it
    // throws EISDIR regardless of permissions (even for root), reliably
    // exercising the "file not readable" catch branch.
    const dirAsLogPath = join(spoolDir, "weird-id.log");
    mkdirSync(dirAsLogPath);
    expect(runner.getProcessOutput("weird-id")).toBeNull();
  });

  it("emits a truncated (<=500 char) output chunk when a single chunk exceeds the throttle size", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('Y'.repeat(2000));"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-throttle", stage: "executor", runtime: "codex" },
    });

    expect(emitter.emitProcessOutput).toHaveBeenCalled();
    const [, , chunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((chunk as string).length).toBeLessThanOrEqual(500);
  });

  it("truncates the rolling buffer to the last 8KB for very large output", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('X'.repeat(10000));"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-4", stage: "executor", runtime: "codex" },
    });

    const files = readdirSync(spoolDir).filter((f) => f.endsWith(".json"));
    const manifest = JSON.parse(readFileSync(join(spoolDir, files[0]!), "utf-8"));
    const output = runner.getProcessOutput(manifest.id);
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
  });
});

describe("ProcessRunner — rehydrateOrphans", () => {
  it("does nothing when the spool directory cannot be read", () => {
    const missingDir = join(spoolDir, "does-not-exist-subdir");
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, missingDir);
    rmSync(missingDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    // PID 999999 is extremely unlikely to be alive.
    const manifest = {
      id: "orphan-1",
      pid: 999999,
      command: "echo",
      args: [],
      runId: "run-orphan",
      stage: "executor",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "orphan-1.log"),
    };
    writeFileSync(join(spoolDir, "orphan-1.json"), JSON.stringify(manifest));

    runner.rehydrateOrphans();

    const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-1.json"), "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-1", pid: 999999 }),
      "Orphaned agent process is dead, marking crashed",
    );
  });

  it("skips manifests that already have a completedAt", () => {
    const manifest = {
      id: "done-1",
      pid: 999999,
      command: "echo",
      args: [],
      runId: "run-done",
      stage: "executor",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "done-1.log"),
      completedAt: new Date().toISOString(),
      exitCode: 0,
    };
    writeFileSync(join(spoolDir, "done-1.json"), JSON.stringify(manifest));

    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("rehydrates a still-alive orphan into activeProcesses and emits process:started", async () => {
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-1.log");
    writeFileSync(logPath, "previous output");

    const manifest = {
      id: "alive-1",
      pid: 424242,
      command: "echo",
      args: [],
      runId: "run-alive",
      stage: "executor",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };
    writeFileSync(join(spoolDir, "alive-1.json"), JSON.stringify(manifest));

    // First liveness check (inside rehydrateOrphans) reports alive; every
    // subsequent check (the background poll started for the orphan) reports
    // dead, so we can deterministically unwind the watcher/interval the
    // implementation starts internally, instead of leaking it past this test.
    vi.useFakeTimers();
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => true as never)
      .mockImplementation(() => {
        throw new Error("no such process");
      });

    try {
      runner.rehydrateOrphans();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive-1", runId: "run-alive" });
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "codex",
        "echo",
      );
      expect(runner.getProcessOutput("alive-1")).toBe("previous output");

      // Advance past the 5s poll interval so it detects the (now-mocked)
      // dead process and tears down its watcher + interval cleanly.
      vi.advanceTimersByTime(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "codex",
        -1,
        expect.any(Number),
      );
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }

    // fs.watch may have an already-queued native callback in flight from
    // setup; give the real event loop a tick to flush it before afterEach
    // deletes the spool directory, so it doesn't fire against a missing file.
    await new Promise((r) => setTimeout(r, 50));
  });

  it("rehydrates an alive orphan whose log file doesn't exist yet", () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "nolog-1.log"); // deliberately never created
    const manifest = {
      id: "nolog-1",
      pid: 424242,
      command: "echo",
      args: [],
      runId: "run-nolog",
      stage: "executor",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };
    writeFileSync(join(spoolDir, "nolog-1.json"), JSON.stringify(manifest));

    vi.useFakeTimers();
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => true as never)
      .mockImplementation(() => {
        throw new Error("no such process");
      });

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);
      // No log file existed, so the rolling buffer starts empty rather than throwing.
      expect(runner.getProcessOutput("nolog-1")).toBe("");

      vi.advanceTimersByTime(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(0);
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("silently tolerates a missing manifest file when finalizing a dead orphan", async () => {
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "nomanifest-1.log");
    writeFileSync(logPath, "x");
    const manifestPath = join(spoolDir, "nomanifest-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "nomanifest-1",
        pid: 424242,
        command: "echo",
        args: [],
        runId: "run-nomanifest",
        stage: "executor",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.useFakeTimers();
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => true as never)
      .mockImplementation(() => {
        throw new Error("no such process");
      });

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the manifest before the finalize poll fires, so finalizeOrphan's
      // best-effort manifest read/update throws and is swallowed.
      rmSync(manifestPath);

      vi.advanceTimersByTime(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-nomanifest",
        "nomanifest-1",
        "executor",
        "codex",
        -1,
        expect.any(Number),
      );
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }

    await new Promise((r) => setTimeout(r, 50));
  });

  it("silently tolerates a missing manifest file when cleaning up a real completed process", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.stdout.write('done'), 80);"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-midflight", stage: "executor", runtime: "codex" },
    });

    await new Promise((r) => setTimeout(r, 20));
    const files = readdirSync(spoolDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    // Remove the manifest mid-flight so cleanupProcess's best-effort
    // read/update throws and is swallowed instead of crashing the process.
    rmSync(join(spoolDir, files[0]!));

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-midflight",
      expect.any(String),
      "executor",
      "codex",
      0,
      expect.any(Number),
    );
  });

  it("appends real on-disk log changes to the rolling buffer via the orphan's file watcher", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const logPath = join(spoolDir, "tail-1.log");
    writeFileSync(logPath, "initial\n");
    const manifest = {
      id: "tail-1",
      pid: 424242,
      command: "echo",
      args: [],
      runId: "run-tail",
      stage: "executor",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };
    writeFileSync(join(spoolDir, "tail-1.json"), JSON.stringify(manifest));

    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true as never);
    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Append to the log file on disk; the orphan's fs.watch should pick
      // this up and extend the in-memory rolling buffer.
      writeFileSync(logPath, "initial\nmore-content\n", { flag: "a" });

      const deadline = Date.now() + 4000;
      let output = runner.getProcessOutput("tail-1");
      while (!output?.includes("more-content") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        output = runner.getProcessOutput("tail-1");
      }
      expect(output).toContain("more-content");
    } finally {
      // Make the orphan appear dead so its watcher/interval tear down
      // before the test ends, instead of leaking past this test.
      killSpy.mockImplementation(() => {
        throw new Error("gone");
      });
      vi.useFakeTimers();
      vi.advanceTimersByTime(5_000);
      vi.useRealTimers();
      killSpy.mockRestore();
    }

    await new Promise((r) => setTimeout(r, 50));
  }, 10_000);

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    writeFileSync(join(spoolDir, "broken.json"), "{not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });
});
