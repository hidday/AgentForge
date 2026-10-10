import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

function freshSpoolDir(): string {
  return mkdtempSync(join(tmpdir(), "pr-test-"));
}

describe("ProcessRunner — constructor defaults", () => {
  it("defaults the spool dir to .foundry/processes under the cwd when none is given", () => {
    const tmpCwd = mkdtempSync(join(tmpdir(), "pr-test-cwd-"));
    const originalCwd = process.cwd();
    process.chdir(tmpCwd);
    try {
      const logger = makeLogger();
      // eslint-disable-next-line no-new
      new ProcessRunner("mock", logger as never);
      expect(existsSync(join(tmpCwd, ".foundry", "processes"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("ProcessRunner — mock mode", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("mock", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("creates the spool directory on construction", () => {
    expect(existsSync(spoolDir)).toBe(true);
  });

  it("throws when execute() is called with no mock handler configured", async () => {
    await expect(
      runner.execute({
        command: "echo",
        args: ["hi"],
        cwd: "/tmp",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates execute() to the configured mock handler", async () => {
    const handler = vi.fn().mockResolvedValue({
      stdout: "mock out",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("mock out");
    expect(result.exitCode).toBe(0);
  });
});

describe("ProcessRunner — getActiveProcesses / getProcessOutput", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("returns null output for an unknown processId", () => {
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads completed-process output from a log file on disk", () => {
    const processId = "log-only-proc";
    writeFileSync(join(spoolDir, `${processId}.log`), "line one\nline two\n");

    const output = runner.getProcessOutput(processId);
    expect(output).toBe("line one\nline two\n");
  });

  it("swallows a read failure and returns null when the log path exists but is unreadable as a file (e.g. a directory)", () => {
    const processId = "dir-not-file-proc";
    // existsSync() is true for a directory too, but readFileSync() on it throws EISDIR.
    mkdirSync(join(spoolDir, `${processId}.log`));

    expect(runner.getProcessOutput(processId)).toBeNull();
  });

  it("returns an empty active-processes list when nothing is running", () => {
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("reflects an in-flight real subprocess in getActiveProcesses and reads its rolling buffer", async () => {
    const promise = runner.execute({
      command: "node",
      args: ["-e", "setTimeout(() => { process.stdout.write('partial'); process.exit(0); }, 150)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-active", stage: "implementing", runtime: "claude-code" },
    });

    // Give the child process a brief moment to spawn and register.
    await new Promise((r) => setTimeout(r, 50));

    const active = runner.getActiveProcesses();
    expect(active.length).toBe(1);
    expect(active[0]).toMatchObject({ runId: "run-active", stage: "implementing", runtime: "claude-code" });
    expect(typeof active[0].pid).toBe("number");
    expect(active[0].elapsedMs).toBeGreaterThanOrEqual(0);

    const processId = active[0].id;
    // Manifest + log file should exist in the spool dir already.
    expect(existsSync(join(spoolDir, `${processId}.json`))).toBe(true);

    await promise;

    // After completion, output should still be retrievable (from the log file).
    const output = runner.getProcessOutput(processId);
    expect(output).toContain("partial");
    expect(runner.getActiveProcesses()).toEqual([]);
  });
});

describe("ProcessRunner — executeReal", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("resolves with stdout and exitCode 0 on success", async () => {
    const result = await runner.execute({
      command: "node",
      args: ["-e", "process.stdout.write('hi'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hi");
    expect(result.timedOut).toBe(false);
  });

  it("resolves with stderr and non-zero exitCode on failure", async () => {
    const result = await runner.execute({
      command: "node",
      args: ["-e", "process.stderr.write('bad'); process.exit(1)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("bad");
  });

  it("rejects with AgentTimeoutError when the process exceeds timeoutMs", async () => {
    await expect(
      runner.execute({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: process.cwd(),
        timeoutMs: 50,
        context: { runId: "run-timeout", stage: "implementing", runtime: "claude-code" },
      }),
    ).rejects.toThrow(AgentTimeoutError);
  }, 10_000);

  it("rejects when spawning a nonexistent command", async () => {
    await expect(
      runner.execute({
        command: "this-binary-does-not-exist-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });

  it("writes stdin to the child process", async () => {
    const result = await runner.execute({
      command: "node",
      args: ["-e", "process.stdin.on('data', (d) => process.stdout.write(d)); process.stdin.on('end', () => process.exit(0));"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdinData: "echoed-input",
    });

    expect(result.stdout).toBe("echoed-input");
    expect(result.exitCode).toBe(0);
  });

  it("writes a manifest/log file and emits process-started/completed with context", async () => {
    const result = await runner.execute({
      command: "node",
      args: ["-e", "process.stdout.write('ctx-out'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-ctx", stage: "planning", runtime: "claude-code" },
    });

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessStarted).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-ctx",
      expect.any(String),
      "planning",
      "claude-code",
      "node",
    );
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    const completedArgs = emitter.emitProcessCompleted.mock.calls[0];
    expect(completedArgs[0]).toBe("run-ctx");
    expect(completedArgs[2]).toBe("planning");
    expect(completedArgs[3]).toBe("claude-code");
    expect(completedArgs[4]).toBe(0);
    expect(typeof completedArgs[5]).toBe("number");

    const processId = emitter.emitProcessStarted.mock.calls[0][1] as string;
    const manifestPath = join(spoolDir, `${processId}.json`);
    const logPath = join(spoolDir, `${processId}.log`);
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(logPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);
  });

  it("does not create a manifest/log file or emit events when no context is passed", async () => {
    await runner.execute({
      command: "node",
      args: ["-e", "process.stdout.write('no-ctx'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner — rehydrateOrphans", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("does nothing (and does not throw) when the spool dir has no manifest files", () => {
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("skips manifests that already have completedAt set", () => {
    writeFileSync(
      join(spoolDir, "done-proc.json"),
      JSON.stringify({
        id: "done-proc",
        pid: 123,
        command: "node",
        args: [],
        runId: "run-done",
        stage: "implementing",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-proc.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a manifest with a dead pid as crashed and does not register it as active", () => {
    const deadPid = 999_999;
    const manifestPath = join(spoolDir, "dead-proc.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-proc",
        pid: deadPid,
        command: "node",
        args: [],
        runId: "run-dead",
        stage: "implementing",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-proc.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      crashed?: boolean;
      exitCode?: number;
      completedAt?: string;
    };
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
  });

  it("registers an alive pid as an active process and emits emitProcessStarted", async () => {
    const alivePid = process.pid;
    writeFileSync(
      join(spoolDir, "alive-proc.json"),
      JSON.stringify({
        id: "alive-proc",
        pid: alivePid,
        command: "node",
        args: ["-e", "x"],
        runId: "run-alive",
        stage: "planning",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "alive-proc.log"),
      }),
    );
    // Pre-seed a log file so the orphan's rollingBuffer gets populated too.
    writeFileSync(join(spoolDir, "alive-proc.log"), "existing log content");

    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive-proc",
      "planning",
      "claude-code",
      "node",
    );
    const active = runner.getActiveProcesses();
    expect(active.length).toBe(1);
    expect(active[0]).toMatchObject({ id: "alive-proc", runId: "run-alive", stage: "planning" });

    const output = runner.getProcessOutput("alive-proc");
    expect(output).toBe("existing log content");

    // rehydrateOrphans opens a real write stream (for log tailing) asynchronously;
    // give it time to finish opening before afterEach deletes the spool dir, to
    // avoid a racy ENOENT on the stream's fd open landing as an unhandled error.
    await new Promise((r) => setTimeout(r, 100));
  });

  it("logs a warning and continues when a manifest file is malformed JSON", () => {
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns without throwing when the spool dir itself cannot be read (e.g. removed)", () => {
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    // Recreate it so the shared afterEach's rmSync doesn't error.
    mkdirSync(spoolDir, { recursive: true });
  });

  it("swallows a missing pre-existing log file for an alive orphan (rollingBuffer stays empty) and still logs a warning for the resulting watch failure", async () => {
    const alivePid = process.pid;
    writeFileSync(
      join(spoolDir, "alive-no-log.json"),
      JSON.stringify({
        id: "alive-no-log",
        pid: alivePid,
        command: "node",
        args: [],
        runId: "run-alive-2",
        stage: "planning",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "alive-no-log.log"),
      }),
    );
    // Deliberately do NOT create alive-no-log.log — fs.watch() on a
    // nonexistent path throws synchronously, which is caught by the
    // per-manifest try/catch in rehydrateOrphans and logged as a warning.

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "alive-no-log.json" }),
      "Failed to process manifest",
    );

    // The alive branch still opens a real (async) write stream for log
    // tailing before the watch() throw unwinds it; give it time to settle
    // before afterEach deletes the spool dir, to avoid a racy ENOENT on
    // the stream's deferred fd open landing as an unhandled error.
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("ProcessRunner — orphan finalization when the pid later dies", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(spoolDir, { recursive: true, force: true });
  });

  // The orphan's liveness poll (setInterval) is created internally the
  // moment rehydrateOrphans() registers it, so faking timers after the
  // fact wouldn't affect an already-real interval. Instead we let the
  // real 5s poll tick fire, with a generous margin above it.
  it(
    "finalizes the orphan (updates manifest, emits emitProcessCompleted) once the periodic liveness poll detects the pid is gone",
    async () => {
      const processId = "finalize-proc";
      const logPath = join(spoolDir, `${processId}.log`);
      const manifestPath = join(spoolDir, `${processId}.json`);
      writeFileSync(logPath, "initial content");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: processId,
          pid: 55555,
          command: "node",
          args: [],
          runId: "run-finalize",
          stage: "implementing",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      let killCalls = 0;
      vi.spyOn(process, "kill").mockImplementation(() => {
        killCalls += 1;
        if (killCalls === 1) return true; // rehydrateOrphans' initial liveness check: alive
        throw new Error("ESRCH"); // every subsequent poll: dead
      });

      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses().map((p) => p.id)).toContain(processId);

      // Let the real 5s poll interval fire at least once.
      await new Promise((r) => setTimeout(r, 5_300));

      expect(runner.getActiveProcesses()).toEqual([]);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-finalize",
        processId,
        "implementing",
        "claude-code",
        -1,
        expect.any(Number),
      );

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        completedAt?: string;
        exitCode?: number;
      };
      expect(manifest.completedAt).toBeDefined();
      expect(manifest.exitCode).toBe(-1);
    },
    10_000,
  );

  it(
    "still finalizes and emits even when the manifest file disappears before the poll fires",
    async () => {
      const processId = "finalize-proc-no-manifest";
      const logPath = join(spoolDir, `${processId}.log`);
      const manifestPath = join(spoolDir, `${processId}.json`);
      writeFileSync(logPath, "initial content");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: processId,
          pid: 55556,
          command: "node",
          args: [],
          runId: "run-finalize-2",
          stage: "implementing",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      let killCalls = 0;
      vi.spyOn(process, "kill").mockImplementation(() => {
        killCalls += 1;
        if (killCalls === 1) return true;
        throw new Error("ESRCH");
      });

      runner.rehydrateOrphans();
      // Give the async log-tailing write stream a moment to finish opening
      // before we delete the manifest out from under it.
      await new Promise((r) => setTimeout(r, 100));
      // Manifest vanishes before the orphan is finalized.
      rmSync(manifestPath, { force: true });

      await new Promise((r) => setTimeout(r, 5_300));

      expect(runner.getActiveProcesses()).toEqual([]);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-finalize-2",
        processId,
        "implementing",
        "claude-code",
        -1,
        expect.any(Number),
      );
    },
    10_000,
  );
});

describe("ProcessRunner — appendToBuffer behavior via executeReal", () => {
  let logger: ReturnType<typeof makeLogger>;
  let spoolDir: string;

  beforeEach(() => {
    logger = makeLogger();
    spoolDir = freshSpoolDir();
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("trims the rolling buffer once it exceeds the max size", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const bigChunk = "x".repeat(9000); // > ROLLING_BUFFER_MAX (8 * 1024)

    const promise = runner.execute({
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(bigChunk)}); process.exit(0)`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-big", stage: "implementing", runtime: "claude-code" },
    });

    await new Promise((r) => setTimeout(r, 50));
    const active = runner.getActiveProcesses();
    if (active.length > 0) {
      const output = runner.getProcessOutput(active[0].id);
      expect(output).not.toBeNull();
      expect((output as string).length).toBeLessThanOrEqual(8 * 1024);
    }

    const result = await promise;
    expect(result.exitCode).toBe(0);
  });

  it("does not throw when no emitter is configured, even with large output", async () => {
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const bigChunk = "y".repeat(2000);

    const result = await runner.execute({
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(bigChunk)}); process.exit(0)`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-no-emitter", stage: "implementing", runtime: "claude-code" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(bigChunk);
  });

  it("emits only the last 500 characters of a large single chunk via emitProcessOutput", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const chunk = "z".repeat(600); // > 500 chars, single write

    const result = await runner.execute({
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(chunk)}); process.exit(0)`],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-emit-chunk", stage: "implementing", runtime: "claude-code" },
    });

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessOutput).toHaveBeenCalled();
    const emittedChunk = emitter.emitProcessOutput.mock.calls[0][2] as string;
    expect(emittedChunk.length).toBe(500);
    expect(emittedChunk).toBe(chunk.slice(-500));
  });
});

describe("ProcessRunner — executeReal edge cases", () => {
  let logger: ReturnType<typeof makeLogger>;
  let emitter: ReturnType<typeof makeEmitter>;
  let spoolDir: string;
  let runner: ProcessRunner;

  beforeEach(() => {
    logger = makeLogger();
    emitter = makeEmitter();
    spoolDir = freshSpoolDir();
    runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("resolves exitCode as 1 (via `code ?? 1`) when the child exits due to a signal (code is null)", async () => {
    const result = await runner.execute({
      command: "node",
      args: ["-e", "process.kill(process.pid, 'SIGKILL');"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(1);
  });

  it("uses the bare command (not context) as the AgentTimeoutError label when no context is passed", async () => {
    await expect(
      runner.execute({
        command: "node",
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: process.cwd(),
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("node") });
  }, 10_000);

  it("cleans up gracefully (no crash) when a context is provided but spawning a nonexistent command fails before a pid exists", async () => {
    await expect(
      runner.execute({
        command: "this-binary-does-not-exist-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 2000,
        context: { runId: "run-spawn-fail", stage: "implementing", runtime: "claude-code" },
      }),
    ).rejects.toThrow();

    // cleanupProcess should have hit its "entry not found" early-return
    // (processId was allocated, but no entry was ever registered since
    // child.pid never existed) without throwing.
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("swallows a manifest-read failure during cleanup (process still resolves normally)", async () => {
    const promise = runner.execute({
      command: "node",
      args: ["-e", "setTimeout(() => { process.stdout.write('done'); process.exit(0); }, 100)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      context: { runId: "run-cleanup-race", stage: "implementing", runtime: "claude-code" },
    });

    await new Promise((r) => setTimeout(r, 20));
    const active = runner.getActiveProcesses();
    expect(active.length).toBe(1);
    // Delete the manifest file out from under cleanupProcess before the
    // process finishes, forcing its manifest-update try/catch to swallow
    // a read failure.
    rmSync(join(spoolDir, `${active[0].id}.json`), { force: true });

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });
});
