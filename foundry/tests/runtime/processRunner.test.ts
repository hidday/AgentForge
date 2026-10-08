import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

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

function makeSpoolDir(dirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "process-runner-"));
  dirs.push(dir);
  return dir;
}

describe("ProcessRunner", () => {
  const dirsToClean: string[] = [];

  afterEach(() => {
    while (dirsToClean.length) {
      const dir = dirsToClean.pop();
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("mock mode", () => {
    it("execute() delegates to the configured mock handler and returns its result", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
      const result = { stdout: "ok", stderr: "", exitCode: 0, durationMs: 5, timedOut: false };
      runner.setMockHandler(vi.fn().mockResolvedValue(result));

      const options: ProcessSpawnOptions = { command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 };
      const actual = await runner.execute(options);

      expect(actual).toBe(result);
    });

    it("execute() throws when mock mode is enabled but no handler is configured", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);

      await expect(
        runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });
  });

  describe("getActiveProcesses() / getProcessOutput()", () => {
    it("getProcessOutput() returns null when there is no live entry and no log file", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      expect(runner.getProcessOutput("missing-id")).toBeNull();
    });

    it("getProcessOutput() reads and tails the on-disk log when there is no live entry", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "proc-1.log"), "hello from disk");

      expect(runner.getProcessOutput("proc-1")).toBe("hello from disk");
    });

    it("getProcessOutput() returns null when the log path exists but cannot be read as a file", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      mkdirSync(join(spoolDir, "proc-1.log"));

      expect(runner.getProcessOutput("proc-1")).toBeNull();
    });

    it("getProcessOutput() prefers the live rolling buffer over the on-disk log", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      (runner as unknown as { activeProcesses: Map<string, { rollingBuffer: string }> }).activeProcesses.set(
        "proc-1",
        { rollingBuffer: "live buffer" } as never,
      );

      expect(runner.getProcessOutput("proc-1")).toBe("live buffer");
    });

    it("getActiveProcesses() projects live entries with elapsed time", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const startedAt = new Date(Date.now() - 1000);
      (
        runner as unknown as {
          activeProcesses: Map<string, unknown>;
        }
      ).activeProcesses.set("proc-1", {
        id: "proc-1",
        pid: 12345,
        command: "echo hi",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        startedAt,
        rollingBuffer: "",
        logStream: null,
        lastEmitMs: 0,
      });

      const [active] = runner.getActiveProcesses();
      expect(active).toMatchObject({
        id: "proc-1",
        pid: 12345,
        command: "echo hi",
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
      });
      expect(active.elapsedMs).toBeGreaterThanOrEqual(1000);
    });
  });

  describe("real mode: executeReal()", () => {
    it("resolves with stdout and exitCode 0 on success, and records a completed manifest", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.timedOut).toBe(false);
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        process.execPath,
      );
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );
      expect(runner.getActiveProcesses()).toHaveLength(0);

      const processId = (emitter.emitProcessStarted.mock.calls[0] as unknown[])[1] as string;
      const manifest = JSON.parse(readFileSync(join(spoolDir, `${processId}.json`), "utf-8"));
      expect(manifest.exitCode).toBe(0);
      expect(typeof manifest.completedAt).toBe("string");
    });

    it("captures stderr and a non-zero exit code", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.stderr.write('boom'); process.exit(3)"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toBe("boom");
    });

    it("forwards stdinData to the child process", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      const result = await runner.execute({
        command: process.execPath,
        args: [
          "-e",
          "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => { process.stdout.write('echo:' + d); process.exit(0); });",
        ],
        cwd: process.cwd(),
        timeoutMs: 10_000,
        stdinData: "ping",
      });

      expect(result.stdout).toBe("echo:ping");
    });

    it("runs without a context and does not create a process manifest", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      await runner.execute({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });

      const { readdirSync } = await import("node:fs");
      expect(readdirSync(spoolDir).filter((f) => f.endsWith(".json"))).toHaveLength(0);
    });

    it("rejects with AgentTimeoutError and kills the child when it exceeds timeoutMs", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      await expect(
        runner.execute({
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 60000)"],
          cwd: process.cwd(),
          timeoutMs: 100,
          context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        }),
      ).rejects.toThrow(AgentTimeoutError);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 100 }),
        "Process timed out",
      );
    }, 15_000);

    it("rejects when the command cannot be spawned", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      await expect(
        runner.execute({
          command: "/definitely/not/a/real/binary-xyz",
          args: [],
          cwd: process.cwd(),
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow();
    });
  });

  describe("appendToBuffer() (private)", () => {
    it("trims the rolling buffer to the max size and throttles dashboard emits", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
      const entry = {
        id: "proc-1",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        rollingBuffer: "",
        lastEmitMs: 0,
      };

      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);

      const privateRunner = runner as unknown as {
        appendToBuffer: (e: typeof entry, text: string) => void;
      };
      privateRunner.appendToBuffer(entry, "a".repeat(9000));
      expect(entry.rollingBuffer.length).toBe(8 * 1024);
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      // A second append at the same instant is throttled (within 250ms window).
      privateRunner.appendToBuffer(entry, "more");
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      // Advancing past the throttle window allows another emit.
      vi.setSystemTime(1_000_300);
      privateRunner.appendToBuffer(entry, "even more");
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    });

    it("emits only the trailing 500 characters when the appended chunk is longer", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
      const entry = {
        id: "proc-1",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        rollingBuffer: "",
        lastEmitMs: 0,
      };
      const longChunk = "b".repeat(600);

      (runner as unknown as { appendToBuffer: (e: typeof entry, text: string) => void }).appendToBuffer(
        entry,
        longChunk,
      );

      const emittedChunk = emitter.emitProcessOutput.mock.calls[0][2] as string;
      expect(emittedChunk).toHaveLength(500);
      expect(emittedChunk).toBe(longChunk.slice(-500));
    });

    it("does nothing when there is no emitter configured", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const entry = {
        id: "proc-1",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        rollingBuffer: "",
        lastEmitMs: 0,
      };

      expect(() =>
        (runner as unknown as { appendToBuffer: (e: typeof entry, text: string) => void }).appendToBuffer(
          entry,
          "text",
        ),
      ).not.toThrow();
    });
  });

  describe("cleanupProcess() (private)", () => {
    it("removes the entry, ends the log stream, and emits completion even when the manifest file is missing", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logStream = { end: vi.fn() };
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.set("proc-1", {
        id: "proc-1",
        pid: 1,
        command: "x",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "",
        logStream,
        lastEmitMs: 0,
      });

      (runner as unknown as { cleanupProcess: (id: string, code: number, ms: number) => void }).cleanupProcess(
        "proc-1",
        0,
        42,
      );

      expect(logStream.end).toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        "proc-1",
        "executor",
        "claude-code",
        0,
        42,
      );
    });

    it("is a no-op when the processId has no active entry", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      (runner as unknown as { cleanupProcess: (id: string, code: number, ms: number) => void }).cleanupProcess(
        "missing",
        0,
        1,
      );

      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });
  });

  describe("rehydrateOrphans()", () => {
    it("is a no-op when the spool directory has no manifest files", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("returns early without throwing when the spool directory cannot be read", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      rmSync(spoolDir, { recursive: true, force: true });

      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that are already marked completed", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      writeFileSync(
        join(spoolDir, "done.json"),
        JSON.stringify({
          id: "done",
          pid: process.pid,
          command: "x",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "done.log"),
          completedAt: new Date().toISOString(),
        }),
      );

      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("marks a manifest crashed when its pid is no longer alive", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const manifestPath = join(spoolDir, "dead.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "dead",
          // PID 1 belongs to init and this process has no permission to signal it,
          // or (in a container) it may not exist; either way process.kill throws.
          pid: 999_999,
          command: "x",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "dead.log"),
        }),
      );
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead" }),
        "Orphaned agent process is dead, marking crashed",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.crashed).toBe(true);
      expect(manifest.exitCode).toBe(-1);
      expect(typeof manifest.completedAt).toBe("string");
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("logs a warning and continues when a manifest file contains invalid JSON", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "broken.json"), "{not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });

    it("rehydrates a manifest whose pid is still alive, without starting the real orphan tailer", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
      // Avoid starting a real fs.watch()/setInterval() loop from this test;
      // that behavior is covered in isolation below.
      const tailSpy = vi
        .spyOn(runner as unknown as { tailLogForOrphan: (id: string, path: string) => void }, "tailLogForOrphan")
        .mockImplementation(() => {});
      writeFileSync(
        join(spoolDir, "alive.json"),
        JSON.stringify({
          id: "alive",
          pid: process.pid,
          command: "claude --print",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "alive.log"),
        }),
      );

      runner.rehydrateOrphans();

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        "alive",
        "executor",
        "claude-code",
        "claude --print",
      );
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(tailSpy).toHaveBeenCalledWith("alive", join(spoolDir, "alive.log"));

      // Let the async createWriteStream open settle, then close it, so it
      // doesn't race the temp-dir cleanup in afterEach with a pending fs open.
      const entry = (runner as unknown as { activeProcesses: Map<string, { logStream: NodeJS.WritableStream }> })
        .activeProcesses.get("alive")!;
      await new Promise<void>((resolveStream, rejectStream) => {
        entry.logStream.on("open", () => resolveStream());
        entry.logStream.on("error", rejectStream);
      });
      (entry.logStream as unknown as { end: () => void }).end();
    });

    it("picks up prior log content into the rolling buffer when rehydrating", async () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      vi.spyOn(runner as unknown as { tailLogForOrphan: (id: string, path: string) => void }, "tailLogForOrphan").mockImplementation(
        () => {},
      );
      const logPath = join(spoolDir, "alive2.log");
      writeFileSync(logPath, "previously logged output");
      writeFileSync(
        join(spoolDir, "alive2.json"),
        JSON.stringify({
          id: "alive2",
          pid: process.pid,
          command: "x",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      runner.rehydrateOrphans();

      expect(runner.getProcessOutput("alive2")).toBe("previously logged output");

      const entry = (runner as unknown as { activeProcesses: Map<string, { logStream: NodeJS.WritableStream }> })
        .activeProcesses.get("alive2")!;
      await new Promise<void>((resolveStream, rejectStream) => {
        entry.logStream.on("open", () => resolveStream());
        entry.logStream.on("error", rejectStream);
      });
      (entry.logStream as unknown as { end: () => void }).end();
    });
  });

  describe("tailLogForOrphan() / finalizeOrphan() (private, via fake timers)", () => {
    it("finalizes the orphan once its process is detected as dead, updating the manifest and emitting completion", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const logPath = join(spoolDir, "orphan.log");
      writeFileSync(logPath, "");
      const manifestPath = join(spoolDir, "orphan.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "orphan",
          pid: 424_242,
          command: "x",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.set("orphan", {
        id: "orphan",
        pid: 424_242,
        command: "x",
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "",
        logStream: null,
        lastEmitMs: 0,
      });

      vi.useFakeTimers();
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      (runner as unknown as { tailLogForOrphan: (id: string, path: string) => void }).tailLogForOrphan(
        "orphan",
        logPath,
      );
      vi.advanceTimersByTime(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        "orphan",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.exitCode).toBe(-1);
      expect(typeof manifest.completedAt).toBe("string");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan" }),
        "Orphaned process has exited",
      );
    });

    it("finalizeOrphan() is a no-op when the entry is already gone", () => {
      const spoolDir = makeSpoolDir(dirsToClean);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      (runner as unknown as { finalizeOrphan: (id: string) => void }).finalizeOrphan("missing");

      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });
  });
});
