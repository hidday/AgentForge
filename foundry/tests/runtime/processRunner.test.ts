import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { RunEventEmitter } from "../../src/api/runEventEmitter.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  } as unknown as RunEventEmitter;
}

describe("ProcessRunner", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  describe("mock mode", () => {
    it("delegates to the configured mock handler", async () => {
      const runner = new ProcessRunner("mock", noopLogger, undefined, spoolDir);
      runner.setMockHandler(async () => ({
        stdout: "mock stdout",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        timedOut: false,
      }));

      const result = await runner.execute({
        command: "claude",
        args: [],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      expect(result.stdout).toBe("mock stdout");
      expect(result.exitCode).toBe(0);
    });

    it("throws when mock mode is enabled but no handler is configured", async () => {
      const runner = new ProcessRunner("mock", noopLogger, undefined, spoolDir);

      await expect(
        runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });
  });

  describe("real mode", () => {
    it("spawns a real process and resolves with its stdout/exit code", async () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);

      const result = await runner.execute({
        command: "node",
        args: ["-e", "process.stdout.write('hello-from-child')"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.stdout).toBe("hello-from-child");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it("captures stderr and a non-zero exit code", async () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);

      const result = await runner.execute({
        command: "node",
        args: ["-e", "process.stderr.write('boom'); process.exit(3)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.stderr).toBe("boom");
      expect(result.exitCode).toBe(3);
    });

    it("writes stdinData to the child process", async () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);

      const result = await runner.execute({
        command: "node",
        args: ["-e", "process.stdin.on('data', (d) => process.stdout.write('got:' + d))"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        stdinData: "hi",
      });

      expect(result.stdout).toBe("got:hi");
    });

    it("rejects with AgentTimeoutError when the process runs past timeoutMs", async () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);

      await expect(
        runner.execute({
          command: "node",
          args: ["-e", "setTimeout(() => {}, 5000)"],
          cwd: process.cwd(),
          timeoutMs: 200,
        }),
      ).rejects.toThrow(/timed out/);
    }, 10000);

    it("rejects when the command cannot be spawned", async () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);

      await expect(
        runner.execute({
          command: "this-command-does-not-exist-xyz",
          args: [],
          cwd: process.cwd(),
          timeoutMs: 2000,
        }),
      ).rejects.toThrow();
    });

    it("tracks a process in getActiveProcesses while it runs, emits lifecycle events, and writes a log file", async () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", noopLogger, emitter, spoolDir);

      const execPromise = runner.execute({
        command: "node",
        args: ["-e", "process.stdout.write('output-chunk'); setTimeout(() => {}, 150)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      await new Promise((r) => setTimeout(r, 50));
      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        "node",
      );

      const liveOutput = runner.getProcessOutput(active[0].id);
      expect(liveOutput).toContain("output-chunk");

      const result = await execPromise;
      expect(result.exitCode).toBe(0);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );

      const logPath = join(spoolDir, `${active[0].id}.log`);
      expect(existsSync(logPath)).toBe(true);
      const afterCompletionOutput = runner.getProcessOutput(active[0].id);
      expect(afterCompletionOutput).toContain("output-chunk");
    });

    it("getProcessOutput returns null for an unknown process id with no log file", () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);
      expect(runner.getProcessOutput("does-not-exist")).toBeNull();
    });
  });

  describe("rehydrateOrphans", () => {
    it("does nothing when the spool directory cannot be listed", () => {
      rmSync(spoolDir, { recursive: true, force: true });
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);
      rmSync(spoolDir, { recursive: true, force: true });

      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("marks an orphan with a dead pid as crashed and updates its manifest", () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);
      const manifest = {
        id: "orphan-1",
        pid: 999_999_999,
        command: "node",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-1.log"),
      };
      writeFileSync(join(spoolDir, "orphan-1.json"), JSON.stringify(manifest));

      runner.rehydrateOrphans();

      const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-1.json"), "utf-8"));
      expect(updated.crashed).toBe(true);
      expect(updated.exitCode).toBe(-1);
      expect(updated.completedAt).toBeDefined();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("skips manifests that are already completed", () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);
      const manifest = {
        id: "done-1",
        pid: 999_999_998,
        command: "node",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-1.log"),
        completedAt: new Date().toISOString(),
      };
      writeFileSync(join(spoolDir, "done-1.json"), JSON.stringify(manifest));

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("rehydrates an orphan whose process is still alive", async () => {
      // This exercises the fs.watch() tailing path, which the production code never
      // explicitly tears down (it is cleaned up only once the orphaned process dies).
      // Use a dedicated directory and leave it in place so the afterEach's rmSync of
      // the shared spoolDir doesn't delete a file the still-active watcher is holding
      // (which otherwise surfaces as an unhandled ENOENT from the watcher's callback).
      const aliveDir = mkdtempSync(join(tmpdir(), "processrunner-alive-test-"));
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", noopLogger, emitter, aliveDir);
      const logPath = join(aliveDir, "alive-1.log");
      writeFileSync(logPath, "previous output\n");

      const manifest = {
        id: "alive-1",
        pid: process.pid,
        command: "node",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      };
      writeFileSync(join(aliveDir, "alive-1.json"), JSON.stringify(manifest));

      runner.rehydrateOrphans();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("alive-1");
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        "alive-1",
        "executor",
        "claude-code",
        "node",
      );
      expect(runner.getProcessOutput("alive-1")).toBe("previous output\n");
    });

    it("logs a warning and continues when a manifest file is malformed", () => {
      const runner = new ProcessRunner("real", noopLogger, undefined, spoolDir);
      writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(noopLogger.warn).toHaveBeenCalled();
    });
  });
});
