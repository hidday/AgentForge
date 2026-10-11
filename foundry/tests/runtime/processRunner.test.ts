import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const mkdirSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
const readdirSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const createWriteStreamMock = vi.fn();
const watchMock = vi.fn();

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
  createWriteStream: (...args: unknown[]) => createWriteStreamMock(...args),
  watch: (...args: unknown[]) => watchMock(...args),
}));

import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions, ProcessContext } from "../../src/runtime/runnerTypes.js";

class FakeChildProcess extends EventEmitter {
  pid: number;
  killed = false;
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => true);

  constructor(pid = 1234) {
    super();
    this.pid = pid;
  }
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

function makeFakeWriteStream() {
  return { write: vi.fn(), end: vi.fn() };
}

const baseOptions: ProcessSpawnOptions = {
  command: "claude",
  args: ["--print"],
  cwd: "/work",
  timeoutMs: 5000,
};

describe("ProcessRunner constructor", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
  });

  it("resolves and creates the spool directory on construction", () => {
    new ProcessRunner("real", makeLogger() as never, undefined, "/custom/spool");
    expect(mkdirSyncMock).toHaveBeenCalledWith(expect.stringContaining("custom/spool"), {
      recursive: true,
    });
  });

  it("defaults the spool directory to .foundry/processes when none is given", () => {
    new ProcessRunner("real", makeLogger() as never);
    expect(mkdirSyncMock).toHaveBeenCalledWith(
      expect.stringContaining(".foundry/processes"),
      { recursive: true },
    );
  });
});

describe("ProcessRunner.execute (mock mode)", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
  });

  it("throws when mock mode is enabled but no handler is configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(runner.execute(baseOptions)).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never);
    const mockResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions);

    expect(handler).toHaveBeenCalledWith(baseOptions);
    expect(result).toBe(mockResult);
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute (real mode)", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    createWriteStreamMock.mockReset();
    spawnMock.mockReset();
    createWriteStreamMock.mockReturnValue(makeFakeWriteStream());
  });

  it("resolves with captured stdout/stderr and exit code 0 on success", async () => {
    const child = new FakeChildProcess(111);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
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
  });

  it("resolves with a non-zero exit code when the process fails", async () => {
    const child = new FakeChildProcess(112);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("boom");
  });

  it("defaults exit code to 1 when close emits a null code", async () => {
    const child = new FakeChildProcess(113);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child process and ends stdin", async () => {
    const child = new FakeChildProcess(114);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, stdinData: "some input" });
    expect(child.stdin.write).toHaveBeenCalledWith("some input");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = new FakeChildProcess(115);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("rejects with the underlying error when spawn emits an 'error' event", async () => {
    const child = new FakeChildProcess(116);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
    const spawnError = new Error("spawn claude ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("spawn claude ENOENT");
  });

  it("merges extra env vars with process.env when spawning", async () => {
    const child = new FakeChildProcess(117);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);

    const promise = runner.execute({
      ...baseOptions,
      timeoutMs: 10_000,
      env: { FOO: "bar" },
    });
    child.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({
        cwd: "/work",
        env: expect.objectContaining({ FOO: "bar" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });

  describe("with a process context (tracking, manifest, emitter events)", () => {
    const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

    it("registers an active process, writes a manifest, and emits process:started", async () => {
      const child = new FakeChildProcess(201);
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        pid: 201,
        command: "claude",
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
      });

      expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
      const [, manifestBody] = writeFileSyncMock.mock.calls[0]!;
      const manifest = JSON.parse(manifestBody as string);
      expect(manifest).toMatchObject({ pid: 201, command: "claude", runId: "run-1" });

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active[0]!.id,
        "executor",
        "claude-code",
        "claude",
      );

      child.emit("close", 0);
      await promise;
    });

    it("streams output chunks to the log file and emits process:output", async () => {
      const child = new FakeChildProcess(202);
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const logStream = makeFakeWriteStream();
      createWriteStreamMock.mockReturnValue(logStream);
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
      child.stdout.emit("data", Buffer.from("partial output"));

      expect(logStream.write).toHaveBeenCalledWith(Buffer.from("partial output"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "partial output",
      );

      child.emit("close", 0);
      await promise;
    });

    it("removes the process from active tracking, updates the manifest, and emits process:completed on close", async () => {
      const child = new FakeChildProcess(203);
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      const logStream = makeFakeWriteStream();
      createWriteStreamMock.mockReturnValue(logStream);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          id: "whatever",
          pid: 203,
          command: "claude",
          args: ["--print"],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: "/spool/whatever.log",
        }),
      );
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
      expect(runner.getActiveProcesses()).toHaveLength(1);

      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(logStream.end).toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );

      // manifest rewritten with completion fields
      const manifestWrites = writeFileSyncMock.mock.calls.filter(
        ([, body]) => typeof body === "string" && JSON.parse(body as string).completedAt,
      );
      expect(manifestWrites.length).toBeGreaterThan(0);
      const finalManifest = JSON.parse(manifestWrites[manifestWrites.length - 1]![1] as string);
      expect(finalManifest.exitCode).toBe(0);
      expect(typeof finalManifest.durationMs).toBe("number");
    });

    it("cleans up and emits process:completed with exitCode -1 when the child errors", async () => {
      const child = new FakeChildProcess(204);
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          id: "whatever",
          pid: 204,
          command: "claude",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: "/spool/whatever.log",
        }),
      );
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
      child.emit("error", new Error("died"));

      await expect(promise).rejects.toThrow("died");
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        expect.any(String),
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
    });

    it("does not throw when the manifest file cannot be read during cleanup", async () => {
      const child = new FakeChildProcess(205);
      spawnMock.mockReturnValue(child);
      const emitter = makeEmitter();
      readFileSyncMock.mockImplementation(() => {
        throw new Error("ENOENT: no manifest");
      });
      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
      child.emit("close", 0);

      await expect(promise).resolves.toMatchObject({ exitCode: 0 });
      expect(emitter.emitProcessCompleted).toHaveBeenCalled();
    });
  });

  describe("timeout handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends SIGTERM at the timeout, escalates to SIGKILL after the grace period, and rejects with AgentTimeoutError", async () => {
      const child = new FakeChildProcess(301);
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
      // swallow the rejection until we're ready to assert, to avoid unhandled rejection warnings
      const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(child.kill).toHaveBeenCalledTimes(2);

      child.emit("close", null);
      await assertion;
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ command: "claude", timeoutMs: 1000 }),
        "Process timed out",
      );
    });

    it("does not escalate to SIGKILL if the child was already killed within the grace period", async () => {
      const child = new FakeChildProcess(302);
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.killed = true; // simulate the process having actually exited from SIGTERM

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledTimes(1); // no SIGKILL issued

      child.emit("close", null);
      await assertion;
    });

    it("clears the timeout and resolves normally when the process finishes before the deadline", async () => {
      const child = new FakeChildProcess(303);
      spawnMock.mockReturnValue(child);
      const runner = new ProcessRunner("real", makeLogger() as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 5000 });
      child.emit("close", 0);
      const result = await promise;
      expect(result.timedOut).toBe(false);

      // Advance well past the timeout window; nothing further should happen.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(child.kill).not.toHaveBeenCalled();
    });
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("returns the rolling buffer for an active process", async () => {
    const child = new FakeChildProcess(401);
    spawnMock.mockReturnValue(child);
    createWriteStreamMock.mockReturnValue(makeFakeWriteStream());
    const runner = new ProcessRunner("real", makeLogger() as never);
    const context: ProcessContext = { runId: "r", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
    child.stdout.emit("data", Buffer.from("buffered output"));
    const activeId = runner.getActiveProcesses()[0]!.id;

    expect(runner.getProcessOutput(activeId)).toBe("buffered output");

    child.emit("close", 0);
    await promise;
  });

  it("reads from the log file on disk when the process is not active", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("stored log contents");
    const runner = new ProcessRunner("real", makeLogger() as never);

    expect(runner.getProcessOutput("some-id")).toBe("stored log contents");
  });

  it("returns null when neither an active process nor a log file exists", () => {
    existsSyncMock.mockReturnValue(false);
    const runner = new ProcessRunner("real", makeLogger() as never);

    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("permission denied");
    });
    const runner = new ProcessRunner("real", makeLogger() as never);

    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    readdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    createWriteStreamMock.mockReset();
    watchMock.mockReset();
    createWriteStreamMock.mockReturnValue(makeFakeWriteStream());
    watchMock.mockReturnValue({ close: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the spool directory cannot be read", () => {
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("ignores non-.json files in the spool directory", () => {
    readdirSyncMock.mockReturnValue(["notes.txt"]);
    const runner = new ProcessRunner("real", makeLogger() as never);
    runner.rehydrateOrphans();
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("skips manifests that are already marked completed", () => {
    readdirSyncMock.mockReturnValue(["done.json"]);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ id: "done", pid: 1, completedAt: "2024-01-01T00:00:00Z" }),
    );
    const runner = new ProcessRunner("real", makeLogger() as never);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates a live orphaned process: sets up tracking and emits process:started", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    const manifest = {
      id: "orphan-1",
      pid: 9999,
      command: "claude",
      args: [],
      runId: "run-x",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/spool/orphan-1.log",
    };
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.endsWith("orphan.json")) return JSON.stringify(manifest);
      return "existing log content";
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);

    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never);
    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-1", pid: 9999 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-x",
      "orphan-1",
      "executor",
      "claude-code",
      "claude",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "orphan-1", pid: 9999, runId: "run-x" });
  });

  it("marks a dead orphaned process as crashed and writes the updated manifest", () => {
    readdirSyncMock.mockReturnValue(["dead.json"]);
    const manifest = {
      id: "dead-1",
      pid: 8888,
      command: "claude",
      args: [],
      runId: "run-y",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/spool/dead-1.log",
    };
    readFileSyncMock.mockReturnValue(JSON.stringify(manifest));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 8888 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [, body] = writeFileSyncMock.mock.calls[0]!;
    const written = JSON.parse(body as string);
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);
    expect(written.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    readdirSyncMock.mockReturnValue(["bad.json"]);
    readFileSyncMock.mockReturnValue("{ not valid json");
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
  });
});
