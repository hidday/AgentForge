import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

// Partially mock node:fs so `readdirSync` and `watch` can be overridden per
// test (rehydrateOrphans / tailLogForOrphan tests), while every other fs
// call (mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream)
// goes through the real filesystem against a scratch temp directory.
// A minimal WriteStream stand-in: real file writes aren't needed by any
// assertion (log content is verified via writeFileSync-created fixtures or
// in-memory rollingBuffer), and avoiding a real fd here sidesteps dangling
// async I/O against directories that afterEach() has already removed.
class FakeWriteStream extends EventEmitter {
  write = vi.fn(() => true);
  end = vi.fn(() => {
    this.emit("finish");
    return this;
  });
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    watch: vi.fn(),
    createWriteStream: vi.fn(() => new FakeWriteStream()),
  };
});

// Mock child_process.spawn so we fully control the child process lifecycle.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { readdirSync, watch } from "node:fs";
import { spawn } from "node:child_process";

const spawnMock = spawn as unknown as Mock;
const readdirSyncMock = readdirSync as unknown as Mock;
const watchMock = watch as unknown as Mock;

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

interface FakeChild extends EventEmitter {
  pid?: number;
  killed: boolean;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: Mock; end: Mock };
  kill: Mock;
}

function createFakeChild(pid: number | undefined = 4242, autoKill = true): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn(() => {
    if (autoKill) child.killed = true;
    return true;
  });
  return child;
}

let scratchDir: string;
let actualReaddirSync: typeof readdirSync;

beforeEach(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
  if (!actualReaddirSync) {
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    actualReaddirSync = actualFs.readdirSync;
  }
  spawnMock.mockReset();
  readdirSyncMock.mockReset();
  readdirSyncMock.mockImplementation((...args: Parameters<typeof readdirSync>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (actualReaddirSync as any)(...args),
  );
  watchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory recursively if it does not exist", () => {
    const spoolDir = join(scratchDir, "nested", "spool");
    expect(existsSync(spoolDir)).toBe(false);

    new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);

    expect(existsSync(spoolDir)).toBe(true);
  });

  it("defaults the spool directory to .foundry/processes under the cwd when none is given", () => {
    const defaultDir = join(process.cwd(), ".foundry", "processes");
    expect(existsSync(defaultDir)).toBe(false);

    try {
      new ProcessRunner("mock", makeMockLogger() as never);
      expect(existsSync(defaultDir)).toBe(true);
    } finally {
      rmSync(join(process.cwd(), ".foundry"), { recursive: true, force: true });
    }
  });
});

describe("ProcessRunner.execute() in mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);

    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, scratchDir);
    const expected: ProcessResult = {
      stdout: "mocked out",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(expected);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--foo"],
      cwd: "/tmp/work",
      timeoutMs: 500,
    };
    const result = await runner.execute(options);

    expect(result).toEqual(expected);
    expect(handler).toHaveBeenCalledWith(options);
    expect(logger.debug).toHaveBeenCalledWith(
      { command: "claude", args: ["--foo"], cwd: "/tmp/work" },
      "Executing mock process",
    );
  });
});

describe("ProcessRunner.execute() in real mode — successful run", () => {
  it("resolves with concatenated stdout/stderr and exitCode 0 on a clean close", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
    });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("a warning"));
    child.emit("close", 0);

    const result = await promise;

    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("a warning");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0 }),
      "Process completed",
    );
  });

  it("reconstructs multi-byte UTF-8 characters split across chunk boundaries", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    // "café" — the 'é' (0xC3 0xA9 in UTF-8) is split across two chunks.
    const full = Buffer.from("café", "utf-8");
    const first = full.subarray(0, 3); // "caf" + first byte of é
    const second = full.subarray(3);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    child.stdout.emit("data", first);
    child.stdout.emit("data", second);
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("café");
  });

  it("resolves with a non-zero exitCode rather than rejecting", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    child.emit("close", 17);

    const result = await promise;
    expect(result.exitCode).toBe(17);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close code is null (killed by signal)", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData and ends stdin when stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "hello stdin",
    });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("only ends stdin (never writes) when stdinData is absent", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("merges extra env vars on top of process.env when spawning", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "mycmd",
      args: ["--flag"],
      cwd: "/some/dir",
      timeoutMs: 1000,
      env: { MY_VAR: "1" },
    });
    child.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "mycmd",
      ["--flag"],
      expect.objectContaining({
        cwd: "/some/dir",
        env: expect.objectContaining({ MY_VAR: "1" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });
});

describe("ProcessRunner.execute() in real mode — spawn/ENOENT errors", () => {
  it("rejects with the spawn error when the child process emits 'error'", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "no-such-binary", args: [], cwd: "/tmp", timeoutMs: 1000 });

    const enoent = Object.assign(new Error("spawn no-such-binary ENOENT"), { code: "ENOENT" });
    child.emit("error", enoent);

    await expect(promise).rejects.toBe(enoent);
  });

  it("still runs cleanup (writes manifest, emits process:completed) when a tracked process errors", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner(
      "real",
      makeMockLogger() as never,
      emitter as never,
      scratchDir,
    );
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "no-such-binary",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledOnce();
    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;

    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    child.emit("error", enoent);

    await expect(promise).rejects.toBe(enoent);

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const manifestPath = join(scratchDir, `${processId}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
  });
});

describe("ProcessRunner.execute() in real mode — timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("kills the process with SIGTERM and rejects with AgentTimeoutError", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "slow-thing",
      args: [],
      cwd: "/tmp",
      timeoutMs: 50,
      context: { runId: "run-9", stage: "planner", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate the process actually exiting in response to SIGTERM.
    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    await expect(promise).rejects.toMatchObject({
      agent: "claude-code/planner",
      timeoutMs: 50,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "slow-thing", timeoutMs: 50 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL if the process has not exited 5s after SIGTERM", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    // autoKill=false: kill() does not flip `killed`, simulating a process
    // that ignores SIGTERM.
    const child = createFakeChild(4242, false);
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "stuck", args: [], cwd: "/tmp", timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when the process already exited before the 5s grace period", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild(4242, false);
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "stuck", args: [], cwd: "/tmp", timeoutMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Process exits and flag is flipped before the grace-period timer fires.
    child.killed = true;
    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});

describe("ProcessRunner — process tracking (getActiveProcesses / manifest)", () => {
  it("tracks an active process, writes its manifest, and emits process:started", async () => {
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, scratchDir);
    const child = createFakeChild(5555);
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-7", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "claude",
      runId: "run-7",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-7",
      active[0]!.id,
      "planner",
      "claude-code",
      "claude",
    );

    const manifestPath = join(scratchDir, `${active[0]!.id}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({
      pid: 5555,
      command: "claude",
      args: ["--version"],
      runId: "run-7",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(manifest.completedAt).toBeUndefined();

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-7",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    const finishedManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finishedManifest.exitCode).toBe(0);
    expect(finishedManifest.completedAt).toBeDefined();
  });

  it("does not track the process when context is given but the child has no pid", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, scratchDir);
    const child = createFakeChild();
    child.pid = undefined;
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-x", stage: "planner", runtime: "claude-code" },
    });

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not track the process when no context is supplied", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await promise;
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("best-effort tolerates a missing/corrupt manifest file during cleanup", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-z", stage: "planner", runtime: "claude-code" },
    });

    const processId = emitter.emitProcessStarted.mock.calls[0]![1] as string;
    rmSync(join(scratchDir, `${processId}.json`));

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // cleanup still ran (process:completed still emitted) even though the
    // manifest file could not be updated.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-z",
      processId,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner — output buffering, trimming and throttled emission", () => {
  it("caps the rolling buffer at 8KB, keeping only the tail", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-big", stage: "planner", runtime: "claude-code" },
    });

    const processId = runner.getActiveProcesses()[0]!.id;
    const bigChunk = "a".repeat(9000);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toBe("a".repeat(8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emission to once per 250ms, sending at most the last 500 chars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 100_000,
      context: { runId: "run-throttle", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-throttle",
      expect.any(String),
      "first",
    );

    vi.setSystemTime(1_000_100); // +100ms: inside throttle window
    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_400); // +300ms since last emit: window elapsed
    const longChunk = "z".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-throttle",
      expect.any(String),
      "z".repeat(500),
    );

    child.emit("close", 0);
    await promise;
  });

  it("never emits process:output when no emitter was configured", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, scratchDir);
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-noemit", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("hello"));
    child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ stdout: "hello" });
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null when the process is neither active nor has a log file on disk", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads the tail of the on-disk log file for a completed/unknown process", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    const content = "x".repeat(9000) + "[END]";
    writeFileSync(join(scratchDir, "proc-1.log"), content);

    const output = runner.getProcessOutput("proc-1");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output!.endsWith("[END]")).toBe(true);
  });

  it("returns null when the log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    // Make "<id>.log" a directory instead of a file, so existsSync is true
    // but readFileSync throws (EISDIR), exercising the catch branch.
    mkdirSync(join(scratchDir, "proc-2.log"));

    expect(runner.getProcessOutput("proc-2")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("does nothing when the spool directory has no manifest files", () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("returns early when readdirSync throws", () => {
    readdirSyncMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: no such directory");
    });
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    writeFileSync(
      join(scratchDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "claude",
        args: [],
        runId: "r",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(scratchDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("mock", makeMockLogger() as never, emitter as never, scratchDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("logs a warning and leaves state untouched when a manifest file is malformed JSON", () => {
    writeFileSync(join(scratchDir, "bad.json"), "{ not valid json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, scratchDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });

  it("stringifies a non-Error thrown while processing a manifest", () => {
    writeFileSync(join(scratchDir, "weird.json"), JSON.stringify({ id: "weird" }));
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "a raw string failure";
    });
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, scratchDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      { file: "weird.json", error: "a raw string failure" },
      "Failed to process manifest",
    );

    parseSpy.mockRestore();
  });

  it("marks a dead orphan (process.kill throws) as crashed and persists exitCode -1", () => {
    const pid = 99999;
    const manifestPath = join(scratchDir, "dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead",
        pid,
        command: "claude",
        args: [],
        runId: "r1",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(scratchDir, "dead.log"),
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, scratchDir);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead", pid }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("rehydrates a live orphan: restores rollingBuffer, emits process:started, and tails the log", () => {
    const pid = 88888;
    const logPath = join(scratchDir, "alive.log");
    writeFileSync(logPath, "original content\n");
    writeFileSync(
      join(scratchDir, "alive.json"),
      JSON.stringify({
        id: "alive",
        pid,
        command: "claude",
        args: ["--version"],
        runId: "run-alive",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const fakeWatcher = { close: vi.fn() };
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return fakeWatcher;
    });

    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, scratchDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid, stage: "planner" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-alive",
      "alive",
      "planner",
      "claude-code",
      "claude",
    );
    expect(runner.getProcessOutput("alive")).toBe("original content\n");
    expect(watchMock).toHaveBeenCalledWith(logPath, expect.any(Function));

    // Simulate the log file growing; the watch callback should pick up the
    // new tail and append it to the rolling buffer.
    writeFileSync(logPath, "original content\nmore stuff", { flag: "a" });
    expect(watchCallback).toBeDefined();
    watchCallback!();
    expect(runner.getProcessOutput("alive")).toContain("more stuff");

    killSpy.mockRestore();
  });

  it("closes the watcher and bails out when the watch callback fires after the entry was removed", async () => {
    vi.useFakeTimers();
    const pid = 77777;
    const logPath = join(scratchDir, "vanished.log");
    writeFileSync(logPath, "hello\n");
    writeFileSync(
      join(scratchDir, "vanished.json"),
      JSON.stringify({
        id: "vanished",
        pid,
        command: "claude",
        args: [],
        runId: "run-v",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let alive = true;
    vi.spyOn(process, "kill").mockImplementation((targetPid) => {
      if (targetPid === pid && alive) return true as never;
      throw new Error("ESRCH");
    });
    const fakeWatcher = { close: vi.fn() };
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return fakeWatcher;
    });

    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Sanity: calling the callback while still tracked does not close the watcher.
    watchCallback!();
    expect(fakeWatcher.close).not.toHaveBeenCalled();

    // Let the poll interval discover the process has died, which removes
    // the entry and closes the watcher once (via finalizeOrphan's own path).
    alive = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);

    // Now a late fs-watch event arrives for a process that is no longer
    // tracked — it should close the watcher again and return, without
    // throwing or touching any buffers.
    expect(() => watchCallback!()).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalledTimes(2);
  });

  it("ignores read errors inside the tail callback (e.g. log replaced by a directory)", () => {
    const pid = 66666;
    const logPath = join(scratchDir, "flaky.log");
    writeFileSync(logPath, "hello\n");
    writeFileSync(
      join(scratchDir, "flaky.json"),
      JSON.stringify({
        id: "flaky",
        pid,
        command: "claude",
        args: [],
        runId: "run-f",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });

    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, scratchDir);
    runner.rehydrateOrphans();

    rmSync(logPath);
    mkdirSync(logPath); // readFileSync on a directory throws EISDIR

    expect(() => watchCallback!()).not.toThrow();
    // Buffer stays as it was restored at rehydrate time, since the read failed.
    expect(runner.getProcessOutput("flaky")).toBe("hello\n");
  });

  it("finalizes an orphan once its poll interval detects the process has died", async () => {
    vi.useFakeTimers();
    const pid = 55555;
    const logPath = join(scratchDir, "poll.log");
    writeFileSync(logPath, "hi\n");
    const manifestPath = join(scratchDir, "poll.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "poll",
        pid,
        command: "claude",
        args: [],
        runId: "run-poll",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((targetPid) => {
      if (targetPid === pid && alive) return true as never;
      throw new Error("ESRCH");
    });
    const fakeWatcher = { close: vi.fn() };
    watchMock.mockImplementation(() => fakeWatcher);

    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, scratchDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    alive = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-poll",
      "poll",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "poll", pid }),
      "Orphaned process has exited",
    );

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBe(-1);
    expect(finalManifest.completedAt).toBeDefined();

    killSpy.mockRestore();
  });

  it("tolerates a missing log file for a live orphan (rollingBuffer stays empty, tail starts from size 0)", () => {
    const pid = 44444;
    const logPath = join(scratchDir, "nolog.log"); // never written
    writeFileSync(
      join(scratchDir, "nolog.json"),
      JSON.stringify({
        id: "nolog",
        pid,
        command: "claude",
        args: [],
        runId: "run-nolog",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });

    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("mock", makeMockLogger() as never, emitter as never, scratchDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getProcessOutput("nolog")).toBe("");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-nolog",
      "nolog",
      "planner",
      "claude-code",
      "claude",
    );

    // The watch callback computes its growth delta against a lastSize that
    // also had to fall back to 0 (readFileSync failed at setup time too).
    writeFileSync(logPath, "now it exists");
    expect(() => watchCallback!()).not.toThrow();
    expect(runner.getProcessOutput("nolog")).toBe("now it exists");
  });

  it("best-effort tolerates a manifest that disappears before an orphan is finalized", async () => {
    vi.useFakeTimers();
    const pid = 33333;
    const logPath = join(scratchDir, "gone.log");
    writeFileSync(logPath, "hi\n");
    const manifestPath = join(scratchDir, "gone.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "gone",
        pid,
        command: "claude",
        args: [],
        runId: "run-gone",
        stage: "planner",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let alive = true;
    vi.spyOn(process, "kill").mockImplementation((targetPid) => {
      if (targetPid === pid && alive) return true as never;
      throw new Error("ESRCH");
    });
    watchMock.mockImplementation(() => ({ close: vi.fn() }));

    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, scratchDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Manifest vanishes before the orphan is ever finalized.
    rmSync(manifestPath);

    alive = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-gone",
      "gone",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "gone", pid }),
      "Orphaned process has exited",
    );
    expect(existsSync(manifestPath)).toBe(false);
  });

  it("finalizes only once when two poll intervals race for the same orphan id (defensive guard + pid fallback)", async () => {
    vi.useFakeTimers();
    const pid = 22222;
    const logPath = join(scratchDir, "dup.log");
    writeFileSync(logPath, "hi\n");
    const sharedManifest = {
      id: "dup",
      pid,
      command: "claude",
      args: [],
      runId: "run-dup",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };
    // Two manifest files resolving to the SAME orphan id: rehydrateOrphans
    // sets up two independent watcher+pollInterval closures that both
    // reference activeProcesses under the single key "dup".
    writeFileSync(join(scratchDir, "dup1.json"), JSON.stringify(sharedManifest));
    writeFileSync(join(scratchDir, "dup2.json"), JSON.stringify(sharedManifest));

    let alive = true;
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true as never;
    });
    watchMock.mockImplementation(() => ({ close: vi.fn() }));

    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, scratchDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    alive = false;
    await vi.advanceTimersByTimeAsync(5000);

    // Only the first poll interval to fire actually finalizes the orphan;
    // the second finds activeProcesses.get("dup") already gone (pid falls
    // back to 0 in the kill probe) and its finalizeOrphan call is a no-op.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dup", pid }),
      "Orphaned process has exited",
    );
    expect(logger.info.mock.calls.filter(([, msg]) => msg === "Orphaned process has exited")).toHaveLength(1);
  });
});
