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
});
