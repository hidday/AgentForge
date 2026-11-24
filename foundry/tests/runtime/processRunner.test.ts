import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeSpoolDir(): string {
  return mkdtempSync(join(tmpdir(), "process-runner-test-"));
}

describe("ProcessRunner", () => {
  let spoolDir: string;

  afterEach(() => {
    if (spoolDir && existsSync(spoolDir)) {
      rmSync(spoolDir, { recursive: true, force: true });
    }
  });

  it("creates the spool directory on construction", () => {
    spoolDir = join(makeSpoolDir(), "nested", "spool");
    expect(existsSync(spoolDir)).toBe(false);

    new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    expect(existsSync(spoolDir)).toBe(true);
  });

  describe("mock mode", () => {
    it("throws when no mock handler has been configured", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);

      await expect(
        runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow(/no mock handler configured/);
    });

    it("delegates to the configured mock handler", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "mocked",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const options: ProcessSpawnOptions = { command: "x", args: ["a"], cwd: "/tmp", timeoutMs: 1000 };
      const result = await runner.execute(options);

      expect(handler).toHaveBeenCalledWith(options);
      expect(result.stdout).toBe("mocked");
    });
  });

  describe("real mode", () => {
    it("spawns a real process and resolves with its stdout/stderr/exitCode", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const result = await runner.execute({
        command: "node",
        args: ["-e", "process.stdout.write('hello'); process.stderr.write('oops'); process.exit(3);"],
        cwd: "/tmp",
        timeoutMs: 10_000,
      });

      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("oops");
      expect(result.exitCode).toBe(3);
      expect(result.timedOut).toBe(false);
    });

    it("writes stdinData to the child process", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const result = await runner.execute({
        command: "node",
        args: ["-e", "process.stdin.on('data', (d) => process.stdout.write(`echo:${d}`));"],
        cwd: "/tmp",
        timeoutMs: 10_000,
        stdinData: "ping",
      });

      expect(result.stdout).toBe("echo:ping");
    });

    it("rejects with AgentTimeoutError when the process exceeds timeoutMs", async () => {
      spoolDir = makeSpoolDir();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      await expect(
        runner.execute({
          command: "node",
          args: ["-e", "setTimeout(() => {}, 30000);"],
          cwd: "/tmp",
          timeoutMs: 200,
        }),
      ).rejects.toThrow(AgentTimeoutError);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 200 }),
        "Process timed out",
      );
    }, 15_000);

    it("tracks an active process by context while running and removes it on completion", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const promise = runner.execute({
        command: "node",
        args: ["-e", "setTimeout(() => { process.stdout.write('done'); process.exit(0); }, 150);"],
        cwd: "/tmp",
        timeoutMs: 10_000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
      expect(active[0]!.command).toBe("node");

      const manifestFiles = readdirSync(spoolDir).filter((f: string) => f.endsWith(".json"));
      expect(manifestFiles).toHaveLength(1);

      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);

      const manifest = JSON.parse(
        readFileSync(join(spoolDir, manifestFiles[0]!), "utf-8"),
      ) as { completedAt?: string; exitCode?: number };
      expect(manifest.completedAt).toBeDefined();
      expect(manifest.exitCode).toBe(0);
    });

    it("emits process lifecycle events through the RunEventEmitter when provided", async () => {
      spoolDir = makeSpoolDir();
      const emitter = {
        emitProcessStarted: vi.fn(),
        emitProcessOutput: vi.fn(),
        emitProcessCompleted: vi.fn(),
      };
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      await runner.execute({
        command: "node",
        args: ["-e", "process.stdout.write('hi'); process.exit(0);"],
        cwd: "/tmp",
        timeoutMs: 10_000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        "node",
      );
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );
    });

    it("rejects when the command cannot be spawned", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      await expect(
        runner.execute({
          command: "this-command-does-not-exist-xyz",
          args: [],
          cwd: "/tmp",
          timeoutMs: 5000,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getProcessOutput", () => {
    it("returns null when the process is neither active nor logged", () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      expect(runner.getProcessOutput("nonexistent")).toBeNull();
    });

    it("reads from the spooled log file for a completed process", async () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      await runner.execute({
        command: "node",
        args: ["-e", "process.stdout.write('logged output'); process.exit(0);"],
        cwd: "/tmp",
        timeoutMs: 10_000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const logFiles = readdirSync(spoolDir).filter((f: string) => f.endsWith(".log"));
      expect(logFiles).toHaveLength(1);
      const processId = logFiles[0]!.replace(/\.log$/, "");

      expect(runner.getProcessOutput(processId)).toBe("logged output");
    });
  });

  describe("rehydrateOrphans", () => {
    it("is a no-op when the spool directory has no manifest files", () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("marks a manifest as crashed when its pid is no longer alive", () => {
      spoolDir = makeSpoolDir();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      // PID 999999 is virtually certain not to correspond to a live process.
      const manifest = {
        id: "proc-1",
        pid: 999999,
        command: "node",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "proc-1.log"),
      };
      writeFileSync(join(spoolDir, "proc-1.json"), JSON.stringify(manifest));

      runner.rehydrateOrphans();

      const updated = JSON.parse(readFileSync(join(spoolDir, "proc-1.json"), "utf-8")) as {
        crashed?: boolean;
        exitCode?: number;
        completedAt?: string;
      };
      expect(updated.crashed).toBe(true);
      expect(updated.exitCode).toBe(-1);
      expect(updated.completedAt).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "proc-1", pid: 999999 }),
        "Orphaned agent process is dead, marking crashed",
      );
    });

    it("skips a manifest that is already marked completed", () => {
      spoolDir = makeSpoolDir();
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const manifest = {
        id: "proc-done",
        pid: 999999,
        command: "node",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "proc-done.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      };
      writeFileSync(join(spoolDir, "proc-done.json"), JSON.stringify(manifest));

      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("skips a manifest file with invalid JSON without throwing", () => {
      spoolDir = makeSpoolDir();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });
  });
});
