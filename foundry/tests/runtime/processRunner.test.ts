import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";

// Mirrors the private constants in src/runtime/processRunner.ts (not exported).
const ROLLING_BUFFER_MAX = 8 * 1024;
const OUTPUT_THROTTLE_MS = 250;

// --- node:fs mock -----------------------------------------------------------
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

// --- node:child_process mock -------------------------------------------------
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// --- deterministic ids --------------------------------------------------------
const idState = vi.hoisted(() => ({ counter: 0 }));
vi.mock("../../src/utils/ids.js", () => ({
  generateId: () => `test-id-${++idState.counter}`,
}));

import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid: number | undefined = 4242;
  killed = false;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
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

/** Wires the fs mocks to a tiny in-memory file map, for realistic manifest round-trips. */
function wireInMemoryFs() {
  const files = new Map<string, string>();
  fsMocks.writeFileSync.mockImplementation((path: unknown, data: unknown) => {
    files.set(String(path), String(data));
  });
  fsMocks.readFileSync.mockImplementation((path: unknown) => {
    const content = files.get(String(path));
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file, open '${String(path)}'`), {
        code: "ENOENT",
      });
    }
    return content;
  });
  fsMocks.existsSync.mockImplementation((path: unknown) => files.has(String(path)));
  return files;
}

beforeEach(() => {
  vi.resetAllMocks();
  idState.counter = 0;
  fsMocks.mkdirSync.mockReturnValue(undefined);
  fsMocks.createWriteStream.mockReturnValue({ write: vi.fn(), end: vi.fn() });
  fsMocks.existsSync.mockReturnValue(false);
  fsMocks.readdirSync.mockReturnValue([]);
  fsMocks.writeFileSync.mockImplementation(() => undefined);
  fsMocks.watch.mockReturnValue({ close: vi.fn() });
  fsMocks.readFileSync.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("resolves and creates the given spool directory", () => {
    new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/custom-spool");
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith("/virtual/custom-spool", { recursive: true });
  });

  it("defaults the spool directory to .foundry/processes resolved from cwd", () => {
    new ProcessRunner("mock", makeLogger() as never);
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(resolve(".foundry/processes"), {
      recursive: true,
    });
  });
});

describe("execute() — mock mode", () => {
  it("throws when mock mode is enabled but no handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("delegates to the configured mock handler and returns its result without spawning a process", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    const mockResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(options);

    expect(result).toBe(mockResult);
    expect(handler).toHaveBeenCalledWith(options);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("execute() — real mode: spawning and I/O plumbing", () => {
  it("spawns with merged env, cwd, and piped stdio", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/work",
      env: { CUSTOM_VAR: "1" },
      timeoutMs: 5000,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/work",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ CUSTOM_VAR: "1" }),
      }),
    );

    child.emit("close", 0);
    await promise;
  });

  it("writes stdinData and ends stdin when provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "hello-stdin",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("hello-stdin");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin immediately without writing when stdinData is absent", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("resolves with stdout/stderr concatenated and exitCode 0 on success", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: ok"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn: ok",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });
  });

  it("resolves (without throwing) on a non-zero exit code, reporting it in exitCode", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 127);

    const result = await promise;
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("falls back to exit code 1 when the child closes with a null code (killed by signal)", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an 'error' event", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      emitter as never,
      "/virtual/spool",
    );

    const context = { runId: "run1", stage: "planner", runtime: "claude-code" };
    const promise = runner.execute({
      command: "bogus",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });

    const err = new Error("spawn bogus ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn bogus ENOENT");
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run1",
      expect.any(String),
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("execute() — real mode: process context, manifest, and active-process tracking", () => {
  it("without a context: does not create a manifest, log stream, or emitter events", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      emitter as never,
      "/virtual/spool",
    );

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("with a context: registers an active process, writes a manifest, and emits process:started", async () => {
    const files = wireInMemoryFs();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      emitter as never,
      "/virtual/spool",
    );

    const context = { runId: "run-42", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute({
      command: "claude",
      args: ["exec"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      command: "claude",
      runId: "run-42",
      stage: "executor",
      runtime: "claude-code",
      pid: child.pid,
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-42",
      active[0]!.id,
      "executor",
      "claude-code",
      "claude",
    );

    const manifestPath = `/virtual/spool/${active[0]!.id}.json`;
    expect(files.has(manifestPath)).toBe(true);
    const manifest = JSON.parse(files.get(manifestPath)!);
    expect(manifest).toMatchObject({
      id: active[0]!.id,
      pid: child.pid,
      runId: "run-42",
      stage: "executor",
      runtime: "claude-code",
    });

    child.emit("close", 0);
    await promise;

    // cleanupProcess removes it from the active list and updates the manifest.
    expect(runner.getActiveProcesses()).toEqual([]);
    const updated = JSON.parse(files.get(manifestPath)!);
    expect(updated.completedAt).toBeDefined();
    expect(updated.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-42",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("computes elapsedMs for active processes relative to the current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0));
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const context = { runId: "r1", stage: "planner", runtime: "claude-code" };
    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context,
    });
    promise.catch(() => undefined);

    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 5, 0));
    const active = runner.getActiveProcesses();
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(5000);

    child.emit("close", 0);
    await promise;
  });

  it("does not register an active process when the child has no pid", async () => {
    const child = new FakeChildProcess();
    child.pid = undefined;
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const context = { runId: "r1", stage: "planner", runtime: "claude-code" };
    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });
});

describe("execute() — timeouts", () => {
  it("rejects with AgentTimeoutError and sends SIGTERM once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/virtual/spool");

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // The (default) fake kill() marks the child killed, so escalation should not fire.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "sleep", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL after 5s when the child ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // Ignore SIGTERM: kill() no longer marks the child as killed.
    child.kill = vi.fn(() => true);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "sleep", args: [], cwd: "/tmp", timeoutMs: 1000 });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("includes the runtime/stage label in the timeout error when a context is present", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const context = { runId: "r1", stage: "executor", runtime: "claude-code" };
    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 500,
      context,
    });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    await expect(promise).rejects.toMatchObject({
      name: "AgentTimeoutError",
      agent: "claude-code/executor",
      timeoutMs: 500,
    });
  });

  it("does not reject with a timeout when the process completes before timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    child.emit("close", 0);
    const result = await promise;
    expect(result.timedOut).toBe(false);

    // Advancing well past timeoutMs afterward must not affect the already-settled promise.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("execute() — output buffering and throttling", () => {
  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX bytes, keeping only the tail", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");
    const context = { runId: "r1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });
    const [{ id: processId }] = runner.getActiveProcesses();

    child.stdout.emit("data", Buffer.from("A".repeat(1000)));
    // Large enough that, combined with the buffer above, the rolling slice fully evicts the A's.
    child.stdout.emit("data", Buffer.from("B".repeat(20_000)));
    const tailMarker = "999-END-999";
    child.stdout.emit("data", Buffer.from(tailMarker));

    const output = runner.getProcessOutput(processId);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(ROLLING_BUFFER_MAX);
    expect(output!.endsWith(tailMarker)).toBe(true);
    expect(output!.includes("A")).toBe(false);

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions to at most one per OUTPUT_THROTTLE_MS, slicing long chunks to 500 chars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0));
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      emitter as never,
      "/virtual/spool",
    );
    const context = { runId: "r1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context,
    });
    promise.catch(() => undefined);

    child.stdout.emit("data", Buffer.from("first-chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Immediately-following chunk is within the throttle window: suppressed.
    child.stdout.emit("data", Buffer.from("second-chunk-immediately"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Advance past the throttle window.
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, OUTPUT_THROTTLE_MS + 50));
    const longText = "X".repeat(600) + "TAILMARK";
    child.stdout.emit("data", Buffer.from(longText));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    const [, , chunkArg] = emitter.emitProcessOutput.mock.calls[1]!;
    expect(chunkArg.length).toBe(500);
    expect((chunkArg as string).endsWith("TAILMARK")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("buffers output but never calls the emitter when none is configured", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");
    const context = { runId: "r1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });
    const [{ id: processId }] = runner.getActiveProcesses();

    expect(() => child.stdout.emit("data", Buffer.from("hello"))).not.toThrow();
    expect(runner.getProcessOutput(processId)).toBe("hello");

    child.emit("close", 0);
    await promise;
  });

  it("writes each stdout/stderr chunk to the process log stream when a context is present", async () => {
    const writeStream = { write: vi.fn(), end: vi.fn() };
    fsMocks.createWriteStream.mockReturnValue(writeStream);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");
    const context = { runId: "r1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });

    const chunk = Buffer.from("stdout chunk");
    child.stdout.emit("data", chunk);
    expect(writeStream.write).toHaveBeenCalledWith(chunk);

    child.emit("close", 0);
    await promise;
    expect(writeStream.end).toHaveBeenCalled();
  });
});

describe("getActiveProcesses", () => {
  it("returns an empty array when there are no active processes", () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(runner.getActiveProcesses()).toEqual([]);
  });
});

describe("getProcessOutput", () => {
  it("returns the in-memory rolling buffer for an active process", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/virtual/spool");
    const context = { runId: "r1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute({
      command: "x",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context,
    });
    const [{ id }] = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("live output"));
    expect(runner.getProcessOutput(id)).toBe("live output");

    child.emit("close", 0);
    await promise;
  });

  it("falls back to the on-disk log, tailed to the buffer limit, when the process is no longer active", () => {
    fsMocks.existsSync.mockReturnValue(true);
    const longContent = "z".repeat(ROLLING_BUFFER_MAX + 500) + "END";
    fsMocks.readFileSync.mockReturnValue(longContent);

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    const output = runner.getProcessOutput("gone-id");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(ROLLING_BUFFER_MAX);
    expect(output!.endsWith("END")).toBe(true);
  });

  it("returns null when neither an active process nor a log file exists", () => {
    fsMocks.existsSync.mockReturnValue(false);
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("rehydrateOrphans", () => {
  it("does nothing when the spool directory cannot be read", () => {
    fsMocks.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("ignores non-.json files and skips manifests already marked completed", () => {
    fsMocks.readdirSync.mockReturnValue(["notes.txt", "done.json"]);
    fsMocks.readFileSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith("done.json")) {
        return JSON.stringify({ id: "done", pid: 1, completedAt: "2026-01-01T00:00:00.000Z" });
      }
      throw new Error("unexpected read: " + String(path));
    });
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("logs a warning and continues when a manifest file fails to parse", () => {
    fsMocks.readdirSync.mockReturnValue(["broken.json"]);
    fsMocks.readFileSync.mockReturnValue("{ not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, "/virtual/spool");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("stringifies a non-Error value thrown while processing a manifest", () => {
    fsMocks.readdirSync.mockReturnValue(["weird.json"]);
    fsMocks.readFileSync.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw-manifest-failure";
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, "/virtual/spool");
    runner.rehydrateOrphans();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "weird.json", error: "raw-manifest-failure" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest with a dead pid as crashed and writes the update", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    fsMocks.readdirSync.mockReturnValue(["orphan.json"]);
    const manifest = {
      id: "orphan",
      pid: 9999,
      command: "claude",
      args: [],
      runId: "r1",
      stage: "planner",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/orphan.log",
    };
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const writes: Array<[string, string]> = [];
    fsMocks.writeFileSync.mockImplementation((p: unknown, data: unknown) =>
      writes.push([String(p), String(data)]),
    );

    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, "/virtual/spool");
    runner.rehydrateOrphans();

    expect(killSpy).toHaveBeenCalledWith(9999, 0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan", pid: 9999, stage: "planner" }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(writes).toHaveLength(1);
    const written = JSON.parse(writes[0]![1]);
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);
    expect(written.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("rehydrates a manifest with a live pid: registers it active, emits started, and seeds the buffer from the log", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    fsMocks.readdirSync.mockReturnValue(["alive.json"]);
    const manifest = {
      id: "alive",
      pid: 555,
      command: "claude",
      args: ["run"],
      runId: "r2",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/alive.log",
    };
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("alive.json")) return JSON.stringify(manifest);
      if (path.endsWith("alive.log")) return "partial output so far";
      throw new Error("ENOENT: " + path);
    });
    let watchListener: (() => void) | undefined;
    fsMocks.watch.mockImplementation((_path: unknown, listener: () => void) => {
      watchListener = listener;
      return { close: vi.fn() };
    });

    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as never,
      "/virtual/spool",
    );
    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: 555, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "r2",
      "alive",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getProcessOutput("alive")).toBe("partial output so far");
    expect(fsMocks.watch).toHaveBeenCalled();
    expect(watchListener).toBeTypeOf("function");

    const [active] = runner.getActiveProcesses();
    expect(active).toMatchObject({ id: "alive", pid: 555, runId: "r2" });
  });

  it("appends newly-written log content to the rolling buffer when the watched file grows", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    fsMocks.readdirSync.mockReturnValue(["alive2.json"]);
    const manifest = {
      id: "alive2",
      pid: 556,
      command: "claude",
      args: [],
      runId: "r3",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/alive2.log",
    };
    let logContent = "start";
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("alive2.json")) return JSON.stringify(manifest);
      if (path.endsWith("alive2.log")) return logContent;
      throw new Error("ENOENT: " + path);
    });
    let watchListener: (() => void) | undefined;
    fsMocks.watch.mockImplementation((_p: unknown, l: () => void) => {
      watchListener = l;
      return { close: vi.fn() };
    });

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("alive2")).toBe("start");

    logContent = "start-and-more";
    watchListener?.();
    expect(runner.getProcessOutput("alive2")).toBe("start-and-more");

    // A read that does not grow the file should not double-append.
    watchListener?.();
    expect(runner.getProcessOutput("alive2")).toBe("start-and-more");
  });

  it("finalizes an orphan once the poll interval detects the process has died", () => {
    vi.useFakeTimers();
    let alive = true;
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true as never;
    });
    fsMocks.readdirSync.mockReturnValue(["orphan3.json"]);
    const manifest = {
      id: "orphan3",
      pid: 777,
      command: "claude",
      args: [],
      runId: "r4",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/orphan3.log",
    };
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("orphan3.json")) return JSON.stringify(manifest);
      if (path.endsWith("orphan3.log")) return "log";
      throw new Error("ENOENT: " + path);
    });
    const closeMock = vi.fn();
    fsMocks.watch.mockReturnValue({ close: closeMock });
    const writes: Array<[string, string]> = [];
    fsMocks.writeFileSync.mockImplementation((p: unknown, data: unknown) =>
      writes.push([String(p), String(data)]),
    );

    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as never,
      "/virtual/spool",
    );
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    alive = false;
    vi.advanceTimersByTime(5000);

    expect(closeMock).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r4",
      "orphan3",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan3", pid: 777 }),
      "Orphaned process has exited",
    );
    expect(writes.length).toBeGreaterThan(0);
    const finalManifest = JSON.parse(writes[writes.length - 1]![1]);
    expect(finalManifest.exitCode).toBe(-1);
    expect(finalManifest.completedAt).toBeDefined();
  });

  it("closes the watcher and no-ops if its listener fires again after the orphan already finalized", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    fsMocks.readdirSync.mockReturnValue(["orphan4.json"]);
    const manifest = {
      id: "orphan4",
      pid: 888,
      command: "claude",
      args: [],
      runId: "r5",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/orphan4.log",
    };
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("orphan4.json")) return JSON.stringify(manifest);
      if (path.endsWith("orphan4.log")) return "log";
      throw new Error("ENOENT: " + path);
    });
    let watchListener: (() => void) | undefined;
    const closeMock = vi.fn();
    fsMocks.watch.mockImplementation((_p: unknown, l: () => void) => {
      watchListener = l;
      return { close: closeMock };
    });
    fsMocks.writeFileSync.mockImplementation(() => undefined);

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    runner.rehydrateOrphans();

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(closeMock).toHaveBeenCalledTimes(1);

    // A late fs.watch event after finalization must not throw, and closes the watcher again.
    expect(() => watchListener?.()).not.toThrow();
    expect(closeMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a read error inside the fs.watch listener without crashing or updating the buffer", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    fsMocks.readdirSync.mockReturnValue(["watcherr.json"]);
    const manifest = {
      id: "watcherr",
      pid: 560,
      command: "claude",
      args: [],
      runId: "r7",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/watcherr.log",
    };
    let failLogReads = false;
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("watcherr.json")) return JSON.stringify(manifest);
      if (path.endsWith("watcherr.log")) {
        if (failLogReads) throw new Error("EIO: read failure");
        return "seed";
      }
      throw new Error("ENOENT: " + path);
    });
    let watchListener: (() => void) | undefined;
    fsMocks.watch.mockImplementation((_p: unknown, l: () => void) => {
      watchListener = l;
      return { close: vi.fn() };
    });

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    runner.rehydrateOrphans();
    expect(runner.getProcessOutput("watcherr")).toBe("seed");

    failLogReads = true;
    expect(() => watchListener?.()).not.toThrow();
    // Buffer is unchanged since the read inside the listener failed.
    expect(runner.getProcessOutput("watcherr")).toBe("seed");
  });

  it("swallows a manifest read/write failure during orphan finalization but still emits completion", () => {
    vi.useFakeTimers();
    let alive = true;
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true as never;
    });
    fsMocks.readdirSync.mockReturnValue(["finalizefail.json"]);
    const manifest = {
      id: "finalizefail",
      pid: 561,
      command: "claude",
      args: [],
      runId: "r8",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/finalizefail.log",
    };
    let manifestReads = 0;
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("finalizefail.json")) {
        manifestReads += 1;
        if (manifestReads === 1) return JSON.stringify(manifest);
        throw new Error("manifest disappeared");
      }
      if (path.endsWith("finalizefail.log")) return "log";
      throw new Error("ENOENT: " + path);
    });
    fsMocks.watch.mockReturnValue({ close: vi.fn() });

    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner(
      "mock",
      logger as never,
      emitter as never,
      "/virtual/spool",
    );
    runner.rehydrateOrphans();

    alive = false;
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r8",
      "finalizefail",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "finalizefail", pid: 561 }),
      "Orphaned process has exited",
    );
  });

  it("falls back to pid 0 for the poll's liveness check and no-ops finalization when the process entry is already gone", () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const closeMock = vi.fn();
    fsMocks.watch.mockReturnValue({ close: closeMock });
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    // Directly exercises tailLogForOrphan for a processId that was never registered as
    // active, covering the `?? 0` pid fallback and finalizeOrphan's early return when
    // the corresponding entry is already gone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runner as any).tailLogForOrphan("never-registered", "/virtual/spool/never-registered.log");

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(killSpy).toHaveBeenCalledWith(0, 0);
    expect(closeMock).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("tolerates a missing log file when seeding the rolling buffer for a live orphan", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    fsMocks.readdirSync.mockReturnValue(["alive5.json"]);
    const manifest = {
      id: "alive5",
      pid: 559,
      command: "claude",
      args: [],
      runId: "r6",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: "/virtual/spool/alive5.log",
    };
    fsMocks.readFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("alive5.json")) return JSON.stringify(manifest);
      throw new Error("ENOENT: " + path);
    });

    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/virtual/spool");
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
  });
});
