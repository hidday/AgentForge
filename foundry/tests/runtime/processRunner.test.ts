import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn as spawnChild } from "node:child_process";
import { ProcessRunner, type MockProcessHandler } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

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

function makeTmpSpoolDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-test-"));
}

/** Spawns and waits for a short-lived real child process to exit, then returns
 * its now-dead pid -- a more reliable "definitely dead" pid than a hardcoded
 * magic number, which could in principle collide with a live process. */
function getDeadPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, ["-e", ""]);
    child.on("exit", () => {
      if (child.pid === undefined) {
        reject(new Error("spawned process has no pid"));
        return;
      }
      resolve(child.pid);
    });
    child.on("error", reject);
  });
}

describe("ProcessRunner real-mode subprocess execution", () => {
  it("resolves stdout, exitCode 0 and timedOut:false on a successful process", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with the child's actual non-zero exit code", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(3);
  });

  it("captures stderr output separately from stdout", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stderr.write('oops'); process.exit(1)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.stderr).toBe("oops");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child and the echoed output appears in stdout", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    const result = await runner.execute({
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => process.exit(0));",
      ],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdinData: "input text",
    });

    expect(result.stdout).toContain("input text");
    expect(result.exitCode).toBe(0);
  });

  it("rejects with AgentTimeoutError when the process outlives timeoutMs", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 2000)"],
        cwd: process.cwd(),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(AgentTimeoutError);
  }, 10_000);

  it("rejects when the child process fails to spawn", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    await expect(
      runner.execute({
        command: "/definitely/not/a/real/binary-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});

describe("ProcessRunner active-process tracking, manifest/log files, and emitter", () => {
  it("tracks the process while active, persists manifest+log files, and emits lifecycle events", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('a'); setTimeout(() => { process.stdout.write('b'); process.exit(0); }, 100);",
      ],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    // The synchronous setup (spawn, activeProcesses registration, manifest
    // write, emitProcessStarted) runs before `execute()`'s returned promise
    // is even constructed as pending, so it's already observable here.
    const activeDuring = runner.getActiveProcesses();
    expect(activeDuring).toHaveLength(1);
    const proc = activeDuring[0]!;
    expect(proc.runId).toBe("run-1");
    expect(proc.stage).toBe("executor");
    expect(proc.runtime).toBe("claude-code");
    expect(proc.command).toBe(process.execPath);
    expect(proc.pid).toBeGreaterThan(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      proc.id,
      "executor",
      "claude-code",
      process.execPath,
    );

    const manifestPath = path.join(spoolDir, `${proc.id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.runId).toBe("run-1");
    expect(manifest.pid).toBe(proc.pid);
    expect(manifest.completedAt).toBeUndefined();

    const result = await promise;
    expect(result.exitCode).toBe(0);

    // cleanupProcess removes the entry once the process has completed.
    expect(runner.getActiveProcesses()).toEqual([]);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      proc.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const logPath = path.join(spoolDir, `${proc.id}.log`);
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, "utf-8");
    expect(logContent).toContain("a");
    expect(logContent).toContain("b");

    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(updatedManifest.completedAt).toBeDefined();
    expect(updatedManifest.exitCode).toBe(0);
    expect(typeof updatedManifest.durationMs).toBe("number");
  });

  it("getProcessOutput reads from the on-disk log file once the process has completed", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('logged-output'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    const [proc] = runner.getActiveProcesses();
    expect(proc).toBeDefined();
    const processId = proc!.id;

    await promise;

    // Entry has been removed from activeProcesses by cleanupProcess, so this
    // exercises the "read from the .log file on disk" fallback path.
    const output = runner.getProcessOutput(processId);
    expect(output).toContain("logged-output");
  });

  it("getProcessOutput returns null for a totally unknown process id", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("getProcessOutput returns null when the on-disk log path exists but cannot be read as a file", () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    // A directory at the expected `${id}.log` path exists() but throws (EISDIR)
    // on readFileSync -- exercising the catch branch even when running as
    // root (where chmod-based unreadability tricks don't apply).
    const bogusId = "bogus-log-is-a-dir";
    fs.mkdirSync(path.join(spoolDir, `${bogusId}.log`));

    expect(runner.getProcessOutput(bogusId)).toBeNull();
  });

  it("getProcessOutput returns the live rolling buffer for a still-active process, capped at ROLLING_BUFFER_MAX, and truncates emitted chunks over 500 chars", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const bigChunk = "x".repeat(9000); // exceeds both ROLLING_BUFFER_MAX (8KB) and the 500-char emit cap
    const script = `process.stdout.write(${JSON.stringify(bigChunk)}); setTimeout(() => process.exit(0), 300);`;

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-big", stage: "executor", runtime: "claude-code" },
    });

    const [proc] = runner.getActiveProcesses();
    expect(proc).toBeDefined();
    const processId = proc!.id;

    // Give the child time to flush the big write over the pipe while it's
    // still alive (the script sleeps 300ms before exiting).
    await new Promise((resolve) => setTimeout(resolve, 150));

    const liveOutput = runner.getProcessOutput(processId);
    expect(liveOutput).not.toBeNull();
    expect(liveOutput!.length).toBeLessThanOrEqual(8 * 1024);

    await promise;

    expect(emitter.emitProcessOutput).toHaveBeenCalled();
    const chunks = emitter.emitProcessOutput.mock.calls.map((c) => c[2] as string);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  }, 10_000);

  it("labels an AgentTimeoutError using context (runtime/stage) when context was provided", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, makeTmpSpoolDir());

    let caught: unknown;
    try {
      await runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 2000)"],
        cwd: process.cwd(),
        timeoutMs: 100,
        context: { runId: "run-to", stage: "reviewer", runtime: "codex" },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentTimeoutError);
    expect((caught as AgentTimeoutError).agent).toBe("codex/reviewer");
  }, 10_000);

  it("falls back to exitCode 1 (not the timeout path) when the process dies by its own signal, not our timeout", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.kill(process.pid, 'SIGKILL');"],
      cwd: process.cwd(),
      timeoutMs: 5000, // generous -- must not be our own timeout firing
      context: { runId: "run-sig", stage: "executor", runtime: "codex" },
    });

    // code is null (signal death) so the `code ?? 1` fallback applies.
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-sig",
      expect.any(String),
      "executor",
      "codex",
      1,
      expect.any(Number),
    );
  }, 10_000);

  it("cleans up the active-process entry (without throwing) when spawn itself fails and context was provided", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    await expect(
      runner.execute({
        command: "/definitely/not/a/real/binary-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-spawnerr", stage: "executor", runtime: "cursor" },
      }),
    ).rejects.toThrow();

    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("swallows a missing manifest file at cleanup time (best-effort update) and still resolves/emits normally", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 100);"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-nomanifest", stage: "executor", runtime: "claude-code" },
    });

    const [proc] = runner.getActiveProcesses();
    expect(proc).toBeDefined();
    const manifestPath = path.join(spoolDir, `${proc!.id}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
    fs.rmSync(manifestPath);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });
});

describe("ProcessRunner mock-mode execution", () => {
  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, makeTmpSpoolDir());
    const handler: MockProcessHandler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 100 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe("mocked");
  });

  it("rejects when mock mode is used without a configured handler", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, makeTmpSpoolDir());

    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 100 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently (no throw, no log) when the spool dir cannot be read", () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    fs.rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips manifests that already have completedAt set", () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const manifest = {
      id: "proc-done",
      pid: 999999,
      command: "x",
      args: [],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: path.join(spoolDir, "proc-done.log"),
      completedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(spoolDir, "proc-done.json"), JSON.stringify(manifest));

    runner.rehydrateOrphans();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a manifest whose pid is dead as crashed and persists the update to disk", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const deadPid = await getDeadPid();
    const manifestPath = path.join(spoolDir, "proc-dead.json");
    const manifest = {
      id: "proc-dead",
      pid: deadPid,
      command: "x",
      args: [],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: path.join(spoolDir, "proc-dead.log"),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "proc-dead", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.completedAt).toBeDefined();
    expect(updated.exitCode).toBe(-1);
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("rehydrates a manifest whose pid is genuinely alive into activeProcesses and emits process:started", async () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const child = spawnChild(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    try {
      await new Promise<void>((resolve) => {
        child.once("spawn", () => resolve());
      });
      const alivePid = child.pid!;

      const manifestPath = path.join(spoolDir, "proc-alive.json");
      const manifest = {
        id: "proc-alive",
        pid: alivePid,
        command: "x",
        args: [],
        runId: "r1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: path.join(spoolDir, "proc-alive.log"),
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "proc-alive", pid: alivePid }),
        "Rehydrating orphaned agent process",
      );
      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe("proc-alive");
      expect(active[0]!.pid).toBe(alivePid);
      expect(active[0]!.runId).toBe("r1");
      expect(active[0]!.stage).toBe("executor");
      expect(active[0]!.runtime).toBe("claude-code");

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith("r1", "proc-alive", "executor", "claude-code", "x");
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("warns and skips a corrupt manifest while still processing the other manifests in the dir", () => {
    const spoolDir = makeTmpSpoolDir();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    fs.writeFileSync(path.join(spoolDir, "corrupt.json"), "{not valid json");

    const goodManifestPath = path.join(spoolDir, "proc-good.json");
    const manifest = {
      id: "proc-good",
      pid: 999999,
      command: "x",
      args: [],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: path.join(spoolDir, "proc-good.log"),
    };
    fs.writeFileSync(goodManifestPath, JSON.stringify(manifest));

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
    const updatedGood = JSON.parse(fs.readFileSync(goodManifestPath, "utf-8"));
    expect(updatedGood.crashed).toBe(true);
  });
});
