import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fsNode from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessContext, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

// tailLogForOrphan (invoked when rehydrating a live orphan) sets up a real
// fs.watch with no 'error' handler attached; watching a file this test then
// deletes in afterEach would throw an uncaught ENOENT asynchronously. Stub
// `watch` so the rehydration logic under test runs deterministically and the
// registered listener can be invoked directly instead of via a real watcher.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as unknown as import("../../src/utils/logger.js").Logger;
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  } as unknown as import("../../src/api/runEventEmitter.js").RunEventEmitter;
}

function makeContext(overrides: Partial<ProcessContext> = {}): ProcessContext {
  return { runId: "run-1", stage: "executor", runtime: "claude-code", ...overrides };
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
  it("creates the spool directory if it doesn't exist", () => {
    const nested = join(spoolDir, "nested", "spool");
    expect(existsSync(nested)).toBe(false);
    new ProcessRunner("mock", makeLogger(), undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger(), undefined, spoolDir);
    await expect(
      runner.execute({ command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = { command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("mocked");
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("ProcessRunner real mode - execute", () => {
  it("captures stdout, stderr, and a non-zero exit code from a real subprocess", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('out-text');process.stderr.write('err-text');process.exit(3)"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(result.stdout).toBe("out-text");
    expect(result.stderr).toBe("err-text");
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("writes stdinData to the child process", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data', d => process.stdout.write('got:' + d))"],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "hello-stdin",
    });

    expect(result.stdout).toBe("got:hello-stdin");
  });

  it("rejects with the spawn error when the command does not exist", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    await expect(
      runner.execute({
        command: "this-command-definitely-does-not-exist-xyz",
        args: [],
        cwd: "/tmp",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });

  it("rejects with AgentTimeoutError and kills the process when it exceeds timeoutMs", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);

    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10000)"],
        cwd: "/tmp",
        timeoutMs: 100,
        context: makeContext(),
      }),
    ).rejects.toThrow(AgentTimeoutError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 100 }),
      "Process timed out",
    );
  }, 10_000);

  it("tracks the process as active while running and cleans it up on completion, notifying the emitter", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger, emitter, spoolDir);
    const context = makeContext();

    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 150)"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
    expect(typeof active[0].pid).toBe("number");
    expect(active[0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "executor",
      "claude-code",
      process.execPath,
    );

    await resultPromise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0].id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifestPath = join(spoolDir, `${active[0].id}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);
  });

  it("does not track a process in activeProcesses when no context is supplied", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 50)"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    await resultPromise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("caps the live rolling buffer at ROLLING_BUFFER_MAX, keeping only the most recent bytes", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const bigText = "a".repeat(9000) + "TAIL_MARKER";
    const resultPromise = runner.execute({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(bigText)}); setTimeout(() => process.exit(0), 300);`,
      ],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: makeContext(),
    });
    const processId = runner.getActiveProcesses()[0].id;

    await vi.waitFor(() => {
      const output = runner.getProcessOutput(processId);
      expect(output).not.toBeNull();
      expect(output!.length).toBeLessThanOrEqual(8 * 1024);
      expect(output).toContain("TAIL_MARKER");
    });

    await resultPromise;
  });

  it("forwards stdout/stderr chunks to the emitter while running", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger(), emitter, spoolDir);
    await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('live-chunk')"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: makeContext(),
    });

    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-1",
      expect.any(String),
      expect.stringContaining("live-chunk"),
    );
  });

  it("completes successfully even if the manifest file disappears before cleanup (best-effort update)", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 150)"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: makeContext(),
    });

    const processId = runner.getActiveProcesses()[0].id;
    rmSync(join(spoolDir, `${processId}.json`));

    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId, exitCode: 0 }),
      "Agent process completed",
    );
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns the live rolling buffer while the process is active", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('chunk-a'); setTimeout(() => process.exit(0), 200)"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: makeContext(),
    });

    const active = runner.getActiveProcesses();
    const processId = active[0].id;

    await vi.waitFor(() => {
      expect(runner.getProcessOutput(processId)).toContain("chunk-a");
    });

    await resultPromise;
  });

  it("falls back to reading the spooled log file once the process has completed", async () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('finished-output')"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: makeContext(),
    });
    const processId = runner.getActiveProcesses()[0].id;
    await resultPromise;

    expect(runner.getProcessOutput(processId)).toContain("finished-output");
  });

  it("returns null when there is no active entry and no log file for the id", () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("is a no-op when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger(), undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("is a no-op when there are no manifest files", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    runner.rehydrateOrphans();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips manifests that already have a completedAt timestamp", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 999999,
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

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    const manifestPath = join(spoolDir, "orphan-dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "orphan-dead",
        pid: 999999,
        command: "x",
        args: [],
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-dead.log"),
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-dead", pid: 999999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates a manifest whose pid is still alive, re-registering it as active", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger, emitter, spoolDir);
    const logPath = join(spoolDir, "orphan-alive.log");
    writeFileSync(logPath, "existing log content");
    writeFileSync(
      join(spoolDir, "orphan-alive.json"),
      JSON.stringify({
        id: "orphan-alive",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "run-2",
        stage: "implementing",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => true as never);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-alive", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-2",
      "orphan-alive",
      "implementing",
      "codex",
      "x",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("orphan-alive");

    // Let the rehydrated entry's internal log WriteStream finish its async
    // open against logPath (which still exists) before afterEach deletes
    // spoolDir out from under it — otherwise the open races the deletion
    // and the stream's unhandled 'error' event crashes the test run.
    await new Promise((r) => setTimeout(r, 100));
  });

  it("forwards newly appended log content through the watch listener, and ignores read errors", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger, emitter, spoolDir);
    const logPath = join(spoolDir, "orphan-alive.log");
    writeFileSync(logPath, "initial");
    writeFileSync(
      join(spoolDir, "orphan-alive.json"),
      JSON.stringify({
        id: "orphan-alive",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "run-2",
        stage: "implementing",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(() => true as never);

    runner.rehydrateOrphans();

    const watchMock = vi.mocked(fsNode.watch);
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));
    const listener = watchMock.mock.calls[0][1] as () => void;

    writeFileSync(logPath, "initial-and-more");
    listener();

    expect(emitter.emitProcessOutput).toHaveBeenCalledWith("run-2", "orphan-alive", "-and-more");

    // Deleting the file before the next change notification should be swallowed, not thrown.
    rmSync(logPath);
    expect(() => listener()).not.toThrow();
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 100));
  });

  it("finalizes a rehydrated orphan once its process disappears, and the watcher then ignores further changes", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger, emitter, spoolDir);
    const logPath = join(spoolDir, "orphan-alive.log");
    writeFileSync(logPath, "data");
    writeFileSync(
      join(spoolDir, "orphan-alive.json"),
      JSON.stringify({
        id: "orphan-alive",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "run-2",
        stage: "implementing",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

    // Fake only the interval timer so the poll loop can be driven synchronously;
    // setTimeout stays real so the delay below still lets the log WriteStream
    // finish its async open before afterEach deletes spoolDir.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 100));

    // The poll now finds the pid gone.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });
    vi.advanceTimersByTime(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-2",
      "orphan-alive",
      "implementing",
      "codex",
      -1,
      expect.any(Number),
    );

    const watchMock = vi.mocked(fsNode.watch);
    const listener = watchMock.mock.calls.at(-1)?.[1] as () => void;
    expect(() => listener()).not.toThrow();
    // No entry left to append to, so no further output should be emitted for it.
    expect(emitter.emitProcessOutput).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("ignores non-.json files in the spool directory", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger, undefined, spoolDir);
    writeFileSync(join(spoolDir, "note.txt"), "not a manifest");

    runner.rehydrateOrphans();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
