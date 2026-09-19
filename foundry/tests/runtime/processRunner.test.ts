import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

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

/**
 * Test-only cleanup: rehydrated orphans left "active" at the end of a test
 * still hold an open log file write stream. Close it before the temp spool
 * directory is removed in afterEach, otherwise the stream's deferred async
 * open can fire after the directory is gone and surface as an unhandled
 * ENOENT rejection in a later test.
 */
function closeAllActiveLogStreams(runner: ProcessRunner): void {
  const activeProcesses = (runner as unknown as {
    activeProcesses: Map<
      string,
      { logStream: { end: () => void; on: (event: string, cb: () => void) => void } | null }
    >;
  }).activeProcesses;
  for (const entry of activeProcesses.values()) {
    // Swallow a deferred "open" error that can otherwise surface as an
    // unhandled exception once the temp spool directory is removed in
    // afterEach, and stop the stream so its handle doesn't linger.
    entry.logStream?.on("error", () => {});
    entry.logStream?.end();
  }
}

describe("ProcessRunner", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // A createWriteStream() opened during a test can still have a deferred
    // async "open" in flight even after end() was called synchronously;
    // give it a tick to settle against the real (still-existing) directory
    // before removing it, so it can't surface as an unhandled ENOENT once
    // the directory is gone.
    await new Promise((r) => setTimeout(r, 20));
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("creates the spool directory on construction", () => {
    const nested = join(spoolDir, "nested", "dir");
    new ProcessRunner("mock", makeLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("uses the default .foundry/processes spool directory when none is provided", () => {
    const originalCwd = process.cwd();
    const tmpCwd = mkdtempSync(join(tmpdir(), "processrunner-cwd-"));
    process.chdir(tmpCwd);
    try {
      new ProcessRunner("mock", makeLogger() as never);
      expect(existsSync(join(tmpCwd, ".foundry", "processes"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  describe("mock mode", () => {
    it("throws when no mock handler is configured", async () => {
      const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
      await expect(
        runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });

    it("delegates to the configured mock handler and logs at debug level", async () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const result = await runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 1000,
      });

      expect(result.stdout).toBe("ok");
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ command: "echo", args: ["hi"] }));
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ command: "echo" }),
        "Executing mock process",
      );
    });
  });

  describe("real mode — executeReal", () => {
    it("resolves with stdout/stderr/exitCode/durationMs on a clean exit", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "console.log('out-line'); console.error('err-line')"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.stdout).toContain("out-line");
      expect(result.stderr).toContain("err-line");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(typeof result.durationMs).toBe("number");
    });

    it("writes stdinData to the child process's stdin", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: [
          "-e",
          "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log('got:'+d));",
        ],
        cwd: process.cwd(),
        timeoutMs: 5000,
        stdinData: "hello-stdin",
      });

      expect(result.stdout).toContain("got:hello-stdin");
    });

    it("ends stdin immediately when no stdinData is provided", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: [
          "-e",
          "process.stdin.resume(); process.stdin.on('end',()=>console.log('stdin-ended'));",
        ],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.stdout).toContain("stdin-ended");
    });

    it("resolves with a non-zero exitCode when the process exits non-zero", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.exitCode).toBe(3);
    });

    it("defaults exitCode to 1 when the child is killed by a signal (null code)", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.kill(process.pid, 'SIGKILL')"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.exitCode).toBe(1);
    });

    it("rejects when the command cannot be spawned", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: "/nonexistent/binary/does-not-exist-xyz",
          args: [],
          cwd: process.cwd(),
          timeoutMs: 5000,
        }),
      ).rejects.toThrow();
    });

    it("kills the process and rejects with AgentTimeoutError when it exceeds timeoutMs", async () => {
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: process.execPath,
          args: ["-e", "setTimeout(()=>{}, 60000)"],
          cwd: process.cwd(),
          timeoutMs: 300,
        }),
      ).rejects.toThrow(AgentTimeoutError);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 300 }),
        "Process timed out",
      );
    }, 10000);

    it("labels the timeout error with runtime/stage when a context is provided", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: process.execPath,
          args: ["-e", "setTimeout(()=>{}, 60000)"],
          cwd: process.cwd(),
          timeoutMs: 300,
          context: { runId: "run-timeout", stage: "executor", runtime: "codex" },
        }),
      ).rejects.toThrow(/codex\/executor/);
    }, 10000);

    it("cleans up the tracked process and writes a crashed manifest when the child errors to spawn (context provided)", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: "/nonexistent/binary/does-not-exist-xyz",
          args: [],
          cwd: process.cwd(),
          timeoutMs: 5000,
          context: { runId: "run-err", stage: "planner", runtime: "claude-code" },
        }),
      ).rejects.toThrow();

      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("tracks an active process, writes a manifest and log file, and emits started/completed events when context is provided", async () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      const execPromise = runner.execute({
        command: process.execPath,
        args: ["-e", "console.log('hello'); setTimeout(()=>{}, 150)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
      });

      await vi.waitFor(() => {
        expect(runner.getActiveProcesses()).toHaveLength(1);
      });

      const active = runner.getActiveProcesses()[0]!;
      expect(active.runId).toBe("run-1");
      expect(active.stage).toBe("planner");
      expect(active.runtime).toBe("claude-code");
      expect(active.command).toBe(process.execPath);
      expect(typeof active.elapsedMs).toBe("number");
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active.id,
        "planner",
        "claude-code",
        process.execPath,
      );

      await execPromise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        active.id,
        "planner",
        "claude-code",
        0,
        expect.any(Number),
      );

      const manifestPath = join(spoolDir, `${active.id}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        completedAt?: string;
        exitCode?: number;
      };
      expect(manifest.completedAt).toBeDefined();
      expect(manifest.exitCode).toBe(0);

      const logPath = join(spoolDir, `${active.id}.log`);
      expect(existsSync(logPath)).toBe(true);
      expect(readFileSync(logPath, "utf-8")).toContain("hello");
    });

    it("does not track an active process, write a manifest, or emit events when no context is provided", async () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      await runner.execute({
        command: process.execPath,
        args: ["-e", "console.log('no-context')"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });

    it("getProcessOutput returns the rolling buffer while active, falls back to the log file after completion, and null for an unknown id", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const execPromise = runner.execute({
        command: process.execPath,
        args: ["-e", "console.log('chunk-a'); setTimeout(()=>console.log('chunk-b'), 50)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-2", stage: "executor", runtime: "codex" },
      });

      await vi.waitFor(() => expect(runner.getActiveProcesses()).toHaveLength(1));
      const id = runner.getActiveProcesses()[0]!.id;

      await vi.waitFor(() => {
        expect(runner.getProcessOutput(id)).toContain("chunk-a");
      });

      await execPromise;

      const output = runner.getProcessOutput(id);
      expect(output).toContain("chunk-a");
      expect(output).toContain("chunk-b");

      expect(runner.getProcessOutput("totally-unknown-id")).toBeNull();
    });

    it("getProcessOutput returns null (rather than throwing) when the log path cannot be read as a file", () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      // existsSync() is true for a directory, but readFileSync() on it throws
      // EISDIR — exercises the "file not readable" catch branch.
      mkdirSync(join(spoolDir, "weird-id.log"));

      expect(runner.getProcessOutput("weird-id")).toBeNull();
    });

    it("resolves cleanly even if the manifest file is deleted mid-run (best-effort manifest update)", async () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      const execPromise = runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(()=>console.log('done'), 100)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-3", stage: "reviewer", runtime: "codex" },
      });

      await vi.waitFor(() => expect(runner.getActiveProcesses()).toHaveLength(1));
      const id = runner.getActiveProcesses()[0]!.id;
      rmSync(join(spoolDir, `${id}.json`));

      await expect(execPromise).resolves.toMatchObject({ exitCode: 0 });
    });
  });

  describe("appendToBuffer (direct unit tests for deterministic throttle/truncation behavior)", () => {
    it("emits process:output once per chunk and truncates the emitted chunk to the last 500 chars", () => {
      const emitter = makeEmitter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir) as any;
      const entry = {
        id: "p1",
        pid: 1,
        command: "x",
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "",
        logStream: null,
        lastEmitMs: 0,
      };

      runner.appendToBuffer(entry, "a".repeat(600));

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith("run-1", "p1", "a".repeat(500));
    });

    it("skips emission for a chunk arriving within the throttle window", () => {
      const emitter = makeEmitter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir) as any;
      const entry = {
        id: "p1",
        pid: 1,
        command: "x",
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "",
        logStream: null,
        lastEmitMs: Date.now(),
      };

      runner.appendToBuffer(entry, "just arrived");

      expect(emitter.emitProcessOutput).not.toHaveBeenCalled();
      expect(entry.rollingBuffer).toBe("just arrived");
    });

    it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX (8KB) chars", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir) as any;
      const entry = {
        id: "p1",
        pid: 1,
        command: "x",
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "x".repeat(8 * 1024),
        logStream: null,
        lastEmitMs: 0,
      };

      runner.appendToBuffer(entry, "TAIL");

      expect(entry.rollingBuffer.length).toBe(8 * 1024);
      expect(entry.rollingBuffer.endsWith("TAIL")).toBe(true);
    });

    it("is a no-op for emission when no emitter is configured", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir) as any;
      const entry = {
        id: "p1",
        pid: 1,
        command: "x",
        context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
        startedAt: new Date(),
        rollingBuffer: "",
        logStream: null,
        lastEmitMs: 0,
      };

      expect(() => runner.appendToBuffer(entry, "hello")).not.toThrow();
    });
  });

  describe("rehydrateOrphans", () => {
    it("returns silently when the spool directory cannot be read", () => {
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      rmSync(spoolDir, { recursive: true, force: true });
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("ignores non-.json files in the spool directory", () => {
      writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("skips manifests that already have a completedAt", () => {
      const manifest = {
        id: "done-1",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-done",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-1.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      };
      writeFileSync(join(spoolDir, "done-1.json"), JSON.stringify(manifest));

      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    });

    it("logs a warning and continues when a manifest file is malformed JSON", () => {
      writeFileSync(join(spoolDir, "bad.json"), "{not valid json");
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "bad.json" }),
        "Failed to process manifest",
      );
    });

    it("marks an orphan manifest crashed when its pid is no longer alive", () => {
      const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
      const deadPid = dead.pid;
      expect(deadPid).toBeTruthy();

      const manifest = {
        id: "orphan-1",
        pid: deadPid,
        command: "echo",
        args: [],
        runId: "run-x",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-1.log"),
      };
      writeFileSync(join(spoolDir, "orphan-1.json"), JSON.stringify(manifest));

      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();

      const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-1.json"), "utf-8")) as {
        crashed?: boolean;
        exitCode?: number;
        completedAt?: string;
      };
      expect(updated.crashed).toBe(true);
      expect(updated.exitCode).toBe(-1);
      expect(updated.completedAt).toBeDefined();
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-1", pid: deadPid }),
        "Orphaned agent process is dead, marking crashed",
      );
    });

    it("rehydrates an orphan whose pid is alive: registers it active, restores buffered output, and emits process:started", () => {
      const logPath = join(spoolDir, "orphan-2.log");
      writeFileSync(logPath, "previously buffered output\n");

      const manifest = {
        id: "orphan-2",
        pid: process.pid, // our own test process pid — guaranteed alive
        command: "claude",
        args: [],
        runId: "run-y",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      };
      writeFileSync(join(spoolDir, "orphan-2.json"), JSON.stringify(manifest));

      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

      // Intercept the 5s liveness-poll timer so this test does not have to
      // wait for it in real time; the fs.watch path is exercised for real.
      const intervalSpy = vi
        .spyOn(global, "setInterval")
        .mockImplementation((() => 0) as never);

      try {
        runner.rehydrateOrphans();

        const active = runner.getActiveProcesses();
        expect(active).toHaveLength(1);
        expect(active[0]!.id).toBe("orphan-2");
        expect(active[0]!.runId).toBe("run-y");
        expect(runner.getProcessOutput("orphan-2")).toContain("previously buffered output");
        expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
          "run-y",
          "orphan-2",
          "executor",
          "claude-code",
          "claude",
        );
      } finally {
        intervalSpy.mockRestore();
        closeAllActiveLogStreams(runner);
      }
    });

    it("rehydrates an orphan even when its log file does not exist yet", () => {
      const manifest = {
        id: "orphan-4",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-w",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-4-never-created.log"),
      };
      writeFileSync(join(spoolDir, "orphan-4.json"), JSON.stringify(manifest));

      const intervalSpy = vi
        .spyOn(global, "setInterval")
        .mockImplementation((() => 0) as never);

      try {
        const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
        expect(() => runner.rehydrateOrphans()).not.toThrow();
        expect(runner.getActiveProcesses()).toHaveLength(1);
        closeAllActiveLogStreams(runner);
      } finally {
        intervalSpy.mockRestore();
      }
    });

    it("streams appended log content into the rolling buffer via fs.watch, then finalizes the orphan once its pid disappears", async () => {
      const logPath = join(spoolDir, "orphan-3.log");
      writeFileSync(logPath, "initial\n");

      const manifest = {
        id: "orphan-3",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-z",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      };
      writeFileSync(join(spoolDir, "orphan-3.json"), JSON.stringify(manifest));

      const emitter = makeEmitter();
      const logger = makeLogger();

      let capturedPoll: (() => void) | undefined;
      const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((fn: () => void) => {
        capturedPoll = fn;
        return 0 as unknown as NodeJS.Timeout;
      }) as never);
      const clearIntervalSpy = vi.spyOn(global, "clearInterval").mockImplementation(() => {});

      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Simulate the tracked CLI process writing more output to its log file.
      appendFileSync(logPath, "appended-chunk\n");

      await vi.waitFor(
        () => {
          expect(runner.getProcessOutput("orphan-3")).toContain("appended-chunk");
        },
        { timeout: 2000 },
      );

      // First poll tick: our own pid is still alive — no-op, stays active.
      capturedPoll?.();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Second poll tick: simulate the tracked process having died.
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH: no such process");
      });
      try {
        capturedPoll?.();
      } finally {
        killSpy.mockRestore();
      }

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-z",
        "orphan-3",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-3" }),
        "Orphaned process has exited",
      );

      const finalManifest = JSON.parse(readFileSync(join(spoolDir, "orphan-3.json"), "utf-8")) as {
        exitCode?: number;
        completedAt?: string;
      };
      expect(finalManifest.exitCode).toBe(-1);
      expect(finalManifest.completedAt).toBeDefined();

      intervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it("finalizeOrphan still removes the process from the active list when its manifest file is missing (best-effort update)", () => {
      const logPath = join(spoolDir, "orphan-5.log");
      writeFileSync(logPath, "");

      const manifest = {
        id: "orphan-5",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-v",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      };
      writeFileSync(join(spoolDir, "orphan-5.json"), JSON.stringify(manifest));

      const emitter = makeEmitter();
      let capturedPoll: (() => void) | undefined;
      const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((fn: () => void) => {
        capturedPoll = fn;
        return 0 as unknown as NodeJS.Timeout;
      }) as never);
      const clearIntervalSpy = vi.spyOn(global, "clearInterval").mockImplementation(() => {});

      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the manifest file before the "process died" poll tick fires,
      // so finalizeOrphan's manifest re-read/update hits its catch branch.
      rmSync(join(spoolDir, "orphan-5.json"));

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH: no such process");
      });
      try {
        capturedPoll?.();
      } finally {
        killSpy.mockRestore();
        intervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-v",
        "orphan-5",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
    });
  });

  describe("cleanupProcess (direct unit test for the defensive not-found branch)", () => {
    it("is a no-op when called for a processId that is not tracked", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir) as any;
      expect(() => runner.cleanupProcess("never-tracked-id", 0, 10)).not.toThrow();
    });
  });
});
