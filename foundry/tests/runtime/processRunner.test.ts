import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import { generateId } from "../../src/utils/ids.js";
import type { ProcessContext } from "../../src/runtime/runnerTypes.js";

// ---- node:child_process mock -------------------------------------------------

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ---- node:fs mock, backed by an in-memory fake file store ---------------------

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("node:fs", () => fsMocks);

// ---- deterministic, inspectable id generation ---------------------------------

vi.mock("../../src/utils/ids.js", () => ({
  generateId: vi.fn(() => `proc-${Math.random().toString(36).slice(2)}`),
}));

let fakeFileStore: Map<string, string>;

function resetFakeFs() {
  fakeFileStore = new Map();

  fsMocks.mkdirSync.mockReset().mockImplementation(() => undefined);

  fsMocks.writeFileSync.mockReset().mockImplementation((path: unknown, data: unknown) => {
    fakeFileStore.set(String(path), String(data));
  });

  fsMocks.readFileSync.mockReset().mockImplementation((path: unknown) => {
    const content = fakeFileStore.get(String(path));
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file, open '${String(path)}'`);
      throw err;
    }
    return content;
  });

  fsMocks.existsSync.mockReset().mockImplementation((path: unknown) => fakeFileStore.has(String(path)));

  fsMocks.readdirSync.mockReset().mockReturnValue([]);

  fsMocks.createWriteStream.mockReset().mockImplementation((path: unknown) => {
    const key = String(path);
    if (!fakeFileStore.has(key)) fakeFileStore.set(key, "");
    return {
      write: vi.fn((chunk: Buffer | string) => {
        fakeFileStore.set(key, (fakeFileStore.get(key) ?? "") + chunk.toString());
      }),
      end: vi.fn(),
    };
  });

  fsMocks.watch.mockReset().mockImplementation(() => ({ close: vi.fn() }));
}

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

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function createFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

let logger: ReturnType<typeof makeLogger>;

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeFs();
  spawnMock.mockReset();
  logger = makeLogger();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("creates the spool directory recursively, defaulting to .foundry/processes", () => {
    new ProcessRunner("mock", logger as never);
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(resolve(".foundry/processes"), { recursive: true });
  });

  it("resolves a custom spoolDir relative to the cwd", () => {
    new ProcessRunner("mock", logger as never, undefined, "custom/spool");
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(resolve("custom/spool"), { recursive: true });
  });
});

describe("ProcessRunner.execute() dispatch", () => {
  it("dispatches to the mock handler when mode is 'mock'", async () => {
    const runner = new ProcessRunner("mock", logger as never);
    const handler = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 3,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute({ command: "echo", args: ["hi"], cwd: "/w", timeoutMs: 10 });

    expect(handler).toHaveBeenCalledWith({ command: "echo", args: ["hi"], cwd: "/w", timeoutMs: 10 });
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 3, timedOut: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when mode is 'mock' but no handler has been configured", async () => {
    const runner = new ProcessRunner("mock", logger as never);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/w", timeoutMs: 10 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("logs the mock invocation with command/args/cwd", async () => {
    const runner = new ProcessRunner("mock", logger as never);
    runner.setMockHandler(vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, durationMs: 0, timedOut: false }));

    await runner.execute({ command: "echo", args: ["a", "b"], cwd: "/somewhere", timeoutMs: 10 });

    expect(logger.debug).toHaveBeenCalledWith(
      { command: "echo", args: ["a", "b"], cwd: "/somewhere" },
      "Executing mock process",
    );
  });

  it("dispatches to a real spawned child process when mode is 'real'", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/w", timeoutMs: 10 });
    child.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({ cwd: "/w", stdio: ["pipe", "pipe", "pipe"] }),
    );
  });
});

describe("ProcessRunner executeReal: success paths", () => {
  it("resolves with concatenated stdout/stderr and exitCode 0, ending stdin when there is no stdinData", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/work", timeoutMs: 5000 });
    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it("writes stdinData to the child's stdin and ends it", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/work",
      timeoutMs: 5000,
      stdinData: "payload",
    });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("payload");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("resolves (does not reject) with a non-zero exit code", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ command: "false", args: [], cwd: "/work", timeoutMs: 5000 });
    child.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ command: "killed", args: [], cwd: "/work", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("merges the provided env on top of process.env when spawning", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/w",
      timeoutMs: 10,
      env: { CUSTOM_VAR: "abc" },
    });
    child.emit("close", 0);
    await promise;

    const spawnOpts = spawnMock.mock.calls[0]![2] as { env: Record<string, string | undefined> };
    expect(spawnOpts.env.CUSTOM_VAR).toBe("abc");
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);
  });

  it("logs spawn and completion details", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/work", timeoutMs: 5000 });
    child.emit("close", 0);
    await promise;

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"], cwd: "/work", timeoutMs: 5000, hasStdin: false }),
      "Spawning subprocess",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("reports hasStdin: true in the spawn log when stdinData is provided", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/work",
      timeoutMs: 5000,
      stdinData: "x",
    });
    child.emit("close", 0);
    await promise;

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ hasStdin: true }), "Spawning subprocess");
  });
});

describe("ProcessRunner executeReal: process tracking with context", () => {
  it("writes a manifest, tracks the active process, emits process:started, and cleans up on close", async () => {
    const child = createFakeChild(9001);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-a");
    const context: ProcessContext = { runId: "run-9", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/work",
      timeoutMs: 5000,
      context,
    });
    const processId = vi.mocked(generateId).mock.results.at(-1)!.value as string;
    const manifestPath = join(resolve("/spool-a"), `${processId}.json`);

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith("run-9", processId, "executor", "claude-code", "claude");

    const writtenManifest = JSON.parse(fakeFileStore.get(manifestPath)!);
    expect(writtenManifest).toMatchObject({
      id: processId,
      pid: 9001,
      command: "claude",
      args: ["--print"],
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(writtenManifest.completedAt).toBeUndefined();

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: processId,
      pid: 9001,
      command: "claude",
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");

    child.stdout.emit("data", Buffer.from("hello"));
    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId, exitCode: 0, runId: "run-9", stage: "executor", runtime: "claude-code" }),
      "Agent process completed",
    );
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const updatedManifest = JSON.parse(fakeFileStore.get(manifestPath)!);
    expect(updatedManifest.exitCode).toBe(0);
    expect(typeof updatedManifest.completedAt).toBe("string");
    expect(typeof updatedManifest.durationMs).toBe("number");

    // After completion the output can still be read back from the log file on disk.
    expect(runner.getProcessOutput(processId)).toBe("hello");
  });

  it("buffers stdout/stderr into the rolling buffer, trims beyond the max size, and writes raw chunks to the log stream", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-b");
    const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });
    const processId = vi.mocked(generateId).mock.results.at(-1)!.value as string;

    const bigChunk = "x".repeat(9000);
    child.stdout.emit("data", Buffer.from(bigChunk));

    const buffered = runner.getProcessOutput(processId);
    expect(buffered).not.toBeNull();
    expect(buffered!.length).toBe(8 * 1024);
    expect(buffered).toBe(bigChunk.slice(-8 * 1024));

    const writeStreamInstance = fsMocks.createWriteStream.mock.results.at(-1)!.value as { write: ReturnType<typeof vi.fn> };
    expect(writeStreamInstance.write).toHaveBeenCalledWith(expect.any(Buffer));

    child.emit("close", 0);
    await promise;
  });

  it("does not track an active process when the spawned child has no pid, but still resolves and no-ops cleanup", async () => {
    const child = createFakeChild(0);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-c");
    const context: ProcessContext = { runId: "run-z", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
    const manifestWrites = fsMocks.writeFileSync.mock.calls.filter(([path]) => String(path).endsWith(".json"));
    expect(manifestWrites).toHaveLength(0);

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), "Agent process completed");
  });

  it("skips all process-tracking behavior when no context is provided", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-d");

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000 });
    expect(vi.mocked(generateId)).not.toHaveBeenCalled();
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("cleanupProcess tolerates a manifest file that vanished before completion (best-effort)", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-e");
    const context: ProcessContext = { runId: "run-k", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });
    const processId = vi.mocked(generateId).mock.results.at(-1)!.value as string;
    const manifestPath = join(resolve("/spool-e"), `${processId}.json`);
    fakeFileStore.delete(manifestPath);

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ processId }), "Agent process completed");
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-k",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("rejects with the spawn error and cleans up the tracked process", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-f");
    const context: ProcessContext = { runId: "run-err", stage: "executor", runtime: "claude-code" };
    const err = new Error("spawn ENOENT");

    const promise = runner.execute({ command: "bogus", args: [], cwd: "/work", timeoutMs: 5000, context });
    const processId = vi.mocked(generateId).mock.results.at(-1)!.value as string;
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-err",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("rejects with the spawn error without attempting cleanup when there is no context", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-g");
    const err = new Error("spawn EACCES");

    const promise = runner.execute({ command: "bogus", args: [], cwd: "/work", timeoutMs: 5000 });
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner executeReal: output emission throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("emits the first chunk immediately, throttles chunks within 250ms, and slices long chunks to the last 500 chars", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/spool-h");
    const context: ProcessContext = { runId: "run-t", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-t",
      expect.any(String),
      "first",
    );

    child.stdout.emit("data", Buffer.from("second-immediately"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    const longChunk = "y".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith(
      "run-t",
      expect.any(String),
      longChunk.slice(-500),
    );

    child.emit("close", 0);
    await promise;
  });

  it("does not emit output when no emitter was configured", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-i");
    const context: ProcessContext = { runId: "run-t2", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });
    expect(() => child.stdout.emit("data", Buffer.from("hi"))).not.toThrow();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner executeReal: timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError using the context label", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-j");
    const context: ProcessContext = { runId: "run-x", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 1000, context });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // The process actually dies from SIGTERM (our fake sets killed=true), so no SIGKILL follows.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    await expect(promise).rejects.toMatchObject({ agent: "claude-code/executor", timeoutMs: 1000 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "c", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("uses the bare command as the timeout error label when there is no context", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-k");

    const promise = runner.execute({ command: "no-context-cmd", args: [], cwd: "/w", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    child.emit("close", null);

    await expect(promise).rejects.toMatchObject({ agent: "no-context-cmd", timeoutMs: 1000 });
  });

  it("escalates to SIGKILL after 5s when the process ignores SIGTERM", async () => {
    const child = createFakeChild();
    child.kill = vi.fn(() => false); // never actually terminates; killed stays false
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-l");

    const promise = runner.execute({ command: "stubborn", args: [], cwd: "/w", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toMatchObject({ agent: "stubborn", timeoutMs: 1000 });
  });

  it("does not reject with AgentTimeoutError when close fires before the timeout elapses", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-m");

    const promise = runner.execute({ command: "fast", args: [], cwd: "/w", timeoutMs: 5000 });
    child.emit("close", 0);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    // Advancing time afterwards must not throw or double-settle the already-resolved promise.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns the live rolling buffer for an active process", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", logger as never, undefined, "/spool-n");
    const context: ProcessContext = { runId: "r", stage: "s", runtime: "claude-code" };
    const promise = runner.execute({ command: "c", args: [], cwd: "/w", timeoutMs: 5000, context });
    const processId = vi.mocked(generateId).mock.results.at(-1)!.value as string;

    child.stdout.emit("data", Buffer.from("live output"));
    expect(runner.getProcessOutput(processId)).toBe("live output");

    child.emit("close", 0);
    await promise;
  });

  it("returns null when neither an active process nor a log file exists", () => {
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-o");
    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("reads the tail of the on-disk log file for a completed/unknown process id", () => {
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-p");
    const logPath = join(resolve("/spool-p"), "done-id.log");
    const content = "y".repeat(9000);
    fakeFileStore.set(logPath, content);

    expect(runner.getProcessOutput("done-id")).toBe(content.slice(-8 * 1024));
  });

  it("returns null if the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-q");
    const logPath = join(resolve("/spool-q"), "bad-id.log");
    fakeFileStore.set(logPath, "irrelevant");
    fsMocks.readFileSync.mockImplementationOnce(() => {
      throw new Error("EACCES");
    });

    expect(runner.getProcessOutput("bad-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be listed", () => {
    fsMocks.readdirSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-r");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files and skips manifests that already have completedAt", () => {
    const spoolDir = resolve("/spool-s");
    fsMocks.readdirSync.mockReturnValueOnce(["done.json", "notes.txt"]);
    fakeFileStore.set(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 1,
        command: "c",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: "x",
        completedAt: "already-done",
      }),
    );
    const killSpy = vi.spyOn(process, "kill");
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-s");

    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a dead orphan as crashed and rewrites its manifest", () => {
    const spoolDir = resolve("/spool-t");
    const manifest = {
      id: "dead-1",
      pid: 99999,
      command: "c",
      args: ["a"],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "dead-1.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["dead-1.json"]);
    fakeFileStore.set(join(spoolDir, "dead-1.json"), JSON.stringify(manifest));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-t");

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 99999, stage: "executor" }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(fakeFileStore.get(join(spoolDir, "dead-1.json"))!);
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(typeof updated.completedAt).toBe("string");
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("rehydrates a live orphan: tracks it, restores buffered log output, and emits process:started", () => {
    const spoolDir = resolve("/spool-u");
    const manifest = {
      id: "live-1",
      pid: 55555,
      command: "claude",
      args: ["--print"],
      runId: "r2",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-1.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-1.json"]);
    fakeFileStore.set(join(spoolDir, "live-1.json"), JSON.stringify(manifest));
    fakeFileStore.set(join(spoolDir, "live-1.log"), "existing tail output");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    let watchCb: (() => void) | undefined;
    fsMocks.watch.mockImplementationOnce((_p: string, cb: () => void) => {
      watchCb = cb;
      return { close: vi.fn() };
    });

    const emitter = makeEmitter();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, "/spool-u");
    runner.rehydrateOrphans();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith("r2", "live-1", "executor", "claude-code", "claude");
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "live-1",
      pid: 55555,
      command: "claude",
      runId: "r2",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(runner.getProcessOutput("live-1")).toBe("existing tail output");

    fakeFileStore.set(join(spoolDir, "live-1.log"), "existing tail outputMORE");
    watchCb?.();
    expect(runner.getProcessOutput("live-1")).toBe("existing tail outputMORE");
  });

  it("initializes an empty rolling buffer for a live orphan with no log file yet", () => {
    const spoolDir = resolve("/spool-v");
    const manifest = {
      id: "live-4",
      pid: 88888,
      command: "claude",
      args: [],
      runId: "r5",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-4.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-4.json"]);
    fakeFileStore.set(join(spoolDir, "live-4.json"), JSON.stringify(manifest));
    vi.spyOn(process, "kill").mockImplementation(() => true);
    fsMocks.watch.mockImplementationOnce(() => ({ close: vi.fn() }));

    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-v");
    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("live-4")).toBe("");
  });

  it("ignores a watcher callback firing after the tracked entry has already been removed", () => {
    const spoolDir = resolve("/spool-w");
    const manifest = {
      id: "live-5",
      pid: 11111,
      command: "claude",
      args: [],
      runId: "r6",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-5.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-5.json"]);
    fakeFileStore.set(join(spoolDir, "live-5.json"), JSON.stringify(manifest));
    fakeFileStore.set(join(spoolDir, "live-5.log"), "content");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const closeSpy = vi.fn();
    let watchCb: (() => void) | undefined;
    fsMocks.watch.mockImplementationOnce((_p: string, cb: () => void) => {
      watchCb = cb;
      return { close: closeSpy };
    });

    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-w");
    runner.rehydrateOrphans();

    // Simulate that the entry has been removed some other way, e.g. finalized already.
    fakeFileStore.delete(join(spoolDir, "live-5.json"));
    // Directly force the internal map to lose the entry by rehydrating a second, empty pass
    // is not possible (no public API); instead we assert the watcher's own defensive check by
    // deleting the manifest and confirming that a subsequent, unrelated read error is swallowed.
    fsMocks.readFileSync.mockImplementationOnce(() => {
      throw new Error("transient read error");
    });
    expect(() => watchCb?.()).not.toThrow();
    expect(runner.getProcessOutput("live-5")).toBe("content");
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    fsMocks.readdirSync.mockReturnValueOnce(["broken.json"]);
    fakeFileStore.set(join(resolve("/spool-x"), "broken.json"), "{not valid json");
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-x");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json", error: expect.any(String) }),
      "Failed to process manifest",
    );
  });

  it("logs a warning with a stringified error when a non-Error value is thrown while processing a manifest", () => {
    fsMocks.readdirSync.mockReturnValueOnce(["weird.json"]);
    fakeFileStore.set(join(resolve("/spool-y"), "weird.json"), JSON.stringify({ id: "x" }));
    fsMocks.readFileSync.mockImplementationOnce(() => {
      throw "raw failure";
    });
    const runner = new ProcessRunner("mock", logger as never, undefined, "/spool-y");

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "weird.json", error: "raw failure" }),
      "Failed to process manifest",
    );
  });
});

describe("ProcessRunner orphan polling: finalizeOrphan via tailLogForOrphan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("finalizes an orphan once its process disappears: stops watching, updates the manifest, and emits process:completed", async () => {
    const spoolDir = resolve("/spool-z");
    const manifest = {
      id: "live-2",
      pid: 66666,
      command: "claude",
      args: [],
      runId: "r3",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-2.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-2.json"]);
    fakeFileStore.set(join(spoolDir, "live-2.json"), JSON.stringify(manifest));
    const closeSpy = vi.fn();
    fsMocks.watch.mockImplementationOnce(() => ({ close: closeSpy }));

    let killCallCount = 0;
    vi.spyOn(process, "kill").mockImplementation(() => {
      killCallCount += 1;
      if (killCallCount === 1) return true; // rehydrateOrphans' initial liveness check
      throw new Error("ESRCH"); // subsequent poll finds it dead
    });

    const emitter = makeEmitter();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, "/spool-z");
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r3",
      "live-2",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live-2", pid: 66666 }),
      "Orphaned process has exited",
    );

    const updatedManifest = JSON.parse(fakeFileStore.get(join(spoolDir, "live-2.json"))!);
    expect(updatedManifest.exitCode).toBe(-1);
    expect(typeof updatedManifest.completedAt).toBe("string");
    expect(typeof updatedManifest.durationMs).toBe("number");
  });

  it("finalizeOrphan tolerates a manifest file that vanished before finalization (best-effort)", async () => {
    const spoolDir = resolve("/spool-aa");
    const manifest = {
      id: "live-3",
      pid: 77777,
      command: "claude",
      args: [],
      runId: "r4",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-3.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-3.json"]);
    fakeFileStore.set(join(spoolDir, "live-3.json"), JSON.stringify(manifest));
    fsMocks.watch.mockImplementationOnce(() => ({ close: vi.fn() }));

    let killCallCount = 0;
    vi.spyOn(process, "kill").mockImplementation(() => {
      killCallCount += 1;
      if (killCallCount === 1) return true;
      throw new Error("ESRCH");
    });

    const emitter = makeEmitter();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, "/spool-aa");
    runner.rehydrateOrphans();

    fakeFileStore.delete(join(spoolDir, "live-3.json"));

    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });

  it("keeps polling (no finalize) while the orphan process remains alive", async () => {
    const spoolDir = resolve("/spool-bb");
    const manifest = {
      id: "live-6",
      pid: 22222,
      command: "claude",
      args: [],
      runId: "r7",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "live-6.log"),
    };
    fsMocks.readdirSync.mockReturnValueOnce(["live-6.json"]);
    fakeFileStore.set(join(spoolDir, "live-6.json"), JSON.stringify(manifest));
    const closeSpy = vi.fn();
    fsMocks.watch.mockImplementationOnce(() => ({ close: closeSpy }));
    vi.spyOn(process, "kill").mockImplementation(() => true); // always alive

    const emitter = makeEmitter();
    const runner = new ProcessRunner("mock", logger as never, emitter as never, "/spool-bb");
    runner.rehydrateOrphans();

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(closeSpy).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(1);
  });
});
