import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { AgentTimeoutError } from "../../src/utils/errors.js";

const { spawnMock, fsMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
    fsMock: {
      createWriteStream: vi.fn(),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      readdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(),
      watch: vi.fn(),
    },
  };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => fsMock);

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  pid = 4242;
  killed = false;
  // Mirrors real Node semantics by default: `killed` becomes true as soon as
  // kill() is invoked (not when the process actually exits).
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

function fakeWriteStream() {
  return { write: vi.fn(), end: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.createWriteStream.mockReturnValue(fakeWriteStream());
  fsMock.existsSync.mockReturnValue(false);
  fsMock.readFileSync.mockReturnValue("");
  fsMock.readdirSync.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner construction", () => {
  it("ensures the spool directory exists on construction", () => {
    const logger = makeLogger();
    new ProcessRunner("mock", logger as never, undefined, "/tmp/spool-dir");

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("spool-dir"),
      { recursive: true },
    );
  });

  it("falls back to the default .foundry/processes spool directory when none is given", () => {
    const logger = makeLogger();
    new ProcessRunner("mock", logger as never, undefined);

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".foundry/processes"),
      { recursive: true },
    );
  });
});

describe("ProcessRunner.execute() dispatch", () => {
  it("throws when in mock mode with no handler configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, "/tmp/spool");

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler in mock mode", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, "/tmp/spool");
    const mockResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const options = { command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result).toBe(mockResult);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"], cwd: "/tmp" }),
      "Executing mock process",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns a real subprocess in real mode", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 5000 });
    child.stdout.emit("data", Buffer.from("out"));
    child.emit("close", 0);

    const result = await promise;
    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(result.stdout).toBe("out");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

describe("ProcessRunner.executeReal() stdin handling", () => {
  it("writes stdinData to the child and ends stdin", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "hello stdin",
    });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("hello stdin");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("just ends stdin (no write) when no stdinData is provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "cat", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("merges extra env vars with process.env", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { CUSTOM_VAR: "value" },
    });
    child.emit("close", 0);
    await promise;

    const spawnOpts = spawnMock.mock.calls[0]![2] as { env: Record<string, string> };
    expect(spawnOpts.env.CUSTOM_VAR).toBe("value");
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);
  });
});

describe("ProcessRunner.executeReal() exit handling", () => {
  it("resolves with a non-zero exit code rather than rejecting", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "false", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("boom");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 7 }),
      "Process completed",
    );
  });

  it("treats a null close code as exit code 1", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an 'error' event (e.g. spawn failure)", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "missing-binary", args: [], cwd: "/tmp", timeoutMs: 5000 });
    const err = new Error("ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("ENOENT");
  });
});

describe("ProcessRunner process tracking (context provided)", () => {
  it("tracks an active process, writes a manifest, and emits start/complete events", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ id: "whatever" }));

    const promise = runner.execute({
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    // While the process is active, it must show up in getActiveProcesses().
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(fsMock.createWriteStream).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    const [, manifestJson] = fsMock.writeFileSync.mock.calls[0]!;
    const manifest = JSON.parse(manifestJson as string);
    expect(manifest).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      manifest.id,
      "planner",
      "claude-code",
      "claude",
    );

    child.stdout.emit("data", Buffer.from("hello"));
    child.emit("close", 0);
    await promise;

    // After completion the process is no longer "active".
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2);
    const [, finalManifestJson] = fsMock.writeFileSync.mock.calls[1]!;
    const finalManifest = JSON.parse(finalManifestJson as string);
    expect(finalManifest.exitCode).toBe(0);
    expect(finalManifest.completedAt).toBeDefined();

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      manifest.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("does not track a process when no context is provided", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fsMock.createWriteStream).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("cleans up and emits exitCode -1 when the child errors out with a tracked context", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ id: "m1" }));

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    child.emit("error", new Error("spawn EACCES"));

    await expect(promise).rejects.toThrow("spawn EACCES");
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-2",
      expect.any(String),
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("best-effort swallows a manifest read failure during cleanup", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("disk read error");
    });

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "planner", runtime: "claude-code" },
    });
    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    // writeFileSync should only have been called once (the initial manifest write);
    // the final manifest update was skipped because readFileSync threw.
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("ProcessRunner output buffering", () => {
  it("writes each chunk to the log stream and the rolling buffer", async () => {
    const logger = makeLogger();
    const logStream = fakeWriteStream();
    fsMock.createWriteStream.mockReturnValue(logStream);
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("chunk-a"));
    child.stderr.emit("data", Buffer.from("chunk-b"));
    expect(logStream.write).toHaveBeenCalledTimes(2);

    const active = runner.getActiveProcesses();
    const output = runner.getProcessOutput(active[0]!.id);
    expect(output).toBe("chunk-achunk-b");

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions and truncates the emitted chunk to the last 500 chars", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const longChunk = "y".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));
    // A second, immediate chunk is throttled (emitted within OUTPUT_THROTTLE_MS of the first).
    child.stdout.emit("data", Buffer.from("more"));

    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect((emittedChunk as string).length).toBe(500);
    expect(emittedChunk).toBe(longChunk.slice(-500));

    child.emit("close", 0);
    await promise;
  });

  it("trims the rolling buffer to the max size once it grows past the cap", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    const hugeChunk = "z".repeat(9000); // > ROLLING_BUFFER_MAX (8 * 1024)
    child.stdout.emit("data", Buffer.from(hugeChunk));

    const active = runner.getActiveProcesses();
    const output = runner.getProcessOutput(active[0]!.id);
    expect(output).toHaveLength(8 * 1024);
    expect(output).toBe(hugeChunk.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("does not attempt to emit output when no emitter was configured", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    // Should not throw even though there's no emitter to notify.
    expect(() => child.stdout.emit("data", Buffer.from("data"))).not.toThrow();

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner timeout handling", () => {
  it("sends SIGTERM on timeout and rejects with AgentTimeoutError once the process closes", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);

    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("uses the bare command as the timeout error label when no context is given", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "my-cli", args: [], cwd: "/tmp", timeoutMs: 500 });

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    await expect(promise).rejects.toThrow(/"my-cli"/);
  });

  it("escalates to SIGKILL after the grace period if the process has not actually died", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    // Simulate a signal that doesn't register as delivered (killed stays false).
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "stuck-cli", args: [], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL when the process already reports killed=true", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess(); // default kill() sets killed = true
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "cli", args: [], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("clears the timeout and does not reject when the process closes before the deadline", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({ command: "fast-cli", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    child.emit("close", 0);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    // Advancing time afterwards must not fire the (cleared) timeout.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns the rolling buffer for a currently active process", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
    child.stdout.emit("data", Buffer.from("live output"));

    const [active] = runner.getActiveProcesses();
    expect(runner.getProcessOutput(active!.id)).toBe("live output");

    child.emit("close", 0);
    await promise;
  });

  it("reads the tail of the log file from disk when the process is no longer active", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("a".repeat(9000));

    const output = runner.getProcessOutput("finished-process-id");

    expect(output).toHaveLength(8 * 1024);
    expect(fsMock.existsSync).toHaveBeenCalledWith(expect.stringContaining("finished-process-id.log"));
  });

  it("returns null when there is no active entry and no log file on disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    fsMock.existsSync.mockReturnValue(false);

    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be listed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("only processes files ending in .json, skipping others", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockReturnValue(["notes.txt", "p1.json.bak", "p1.log"]);

    runner.rehydrateOrphans();

    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it("skips a manifest that already has completedAt set", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockReturnValue(["done.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ id: "done", pid: 1, completedAt: "2025-01-01T00:00:00.000Z" }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("marks a dead orphan as crashed and rewrites its manifest", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockReturnValue(["dead.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ id: "dead-1", pid: 9999, stage: "planner", startedAt: "2025-01-01T00:00:00.000Z" }),
    );
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 9999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const writeCall = fsMock.writeFileSync.mock.calls.find((c) =>
      (c[0] as string).includes("dead.json"),
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);
    expect(written.completedAt).toBeDefined();

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file is unreadable or malformed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockReturnValue(["corrupt.json"]);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("bad read");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json", error: "bad read" }),
      "Failed to process manifest",
    );
  });

  it("stringifies a non-Error throw when a manifest file cannot be processed", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fsMock.readdirSync.mockReturnValue(["corrupt2.json"]);
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    fsMock.readFileSync.mockImplementation(() => {
      throw "a raw string failure";
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt2.json", error: "a raw string failure" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates a live orphan: tracks it, emits process:started, and tails its log for new output", () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live.json"]);
    fsMock.readFileSync.mockImplementation((path: string) => {
      if (path.includes("live.json")) {
        return JSON.stringify({
          id: "live-1",
          pid: 555,
          command: "claude",
          args: [],
          runId: "run-9",
          stage: "executor",
          runtime: "claude-code",
          startedAt: "2025-01-01T00:00:00.000Z",
        });
      }
      // the orphan's existing log file content
      return "existing log content";
    });

    let watchCallback: (() => void) | undefined;
    const fakeWatcher = { close: vi.fn() };
    fsMock.watch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return fakeWatcher;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live-1", pid: 555, stage: "executor" }),
      "Rehydrating orphaned agent process",
    );
    expect(fsMock.createWriteStream).toHaveBeenCalledWith(
      expect.stringContaining("live-1.log"),
      { flags: "a" },
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      "live-1",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("live-1")).toBe("existing log content");

    // Simulate the log file growing: readFileSync now returns more content.
    fsMock.readFileSync.mockImplementation((path: string) => {
      if (path.includes("live.json")) return JSON.stringify({});
      return "existing log contentNEW DATA";
    });
    watchCallback?.();
    expect(runner.getProcessOutput("live-1")).toBe("existing log contentNEW DATA");

    // Now simulate the orphan actually dying: process.kill starts throwing.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("manifest gone");
    });

    vi.advanceTimersByTime(5_000);

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      "live-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "live-1", pid: 555 }),
      "Orphaned process has exited",
    );

    killSpy.mockRestore();
  });

  it("the orphan log watcher closes itself and returns early once the entry is no longer active", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live2.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        id: "live-2",
        pid: 777,
        command: "claude",
        args: [],
        runId: "run-10",
        stage: "planner",
        runtime: "claude-code",
        startedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    let watchCallback: (() => void) | undefined;
    const fakeWatcher = { close: vi.fn() };
    fsMock.watch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return fakeWatcher;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Directly simulate the entry having already been removed (e.g. finalized by the
    // poll loop) before a late fs.watch change event fires.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "live-2",
    );

    expect(() => watchCallback?.()).not.toThrow();
    expect(fakeWatcher.close).toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("swallows a read error from the orphan log watcher callback", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live3.json"]);
    fsMock.readFileSync.mockReturnValueOnce(
      JSON.stringify({
        id: "live-3",
        pid: 888,
        command: "claude",
        args: [],
        runId: "run-11",
        stage: "planner",
        runtime: "claude-code",
        startedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    // Existing-log read inside rehydrateOrphans (tries once, fails -> caught).
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw new Error("no log yet");
    });

    let watchCallback: (() => void) | undefined;
    const fakeWatcher = { close: vi.fn() };
    fsMock.watch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return fakeWatcher;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();

    // Now make the watcher's own readFileSync call throw too.
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("read error during tail");
    });

    expect(() => watchCallback?.()).not.toThrow();

    killSpy.mockRestore();
  });

  it("tolerates a missing orphan log file when starting to tail it (no prior size to compare against)", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live5.json"]);
    let readCallCount = 0;
    fsMock.readFileSync.mockImplementation(() => {
      readCallCount += 1;
      if (readCallCount === 1) {
        return JSON.stringify({
          id: "live-5",
          pid: 1010,
          command: "claude",
          args: [],
          runId: "run-13",
          stage: "planner",
          runtime: "claude-code",
          startedAt: "2025-01-01T00:00:00.000Z",
        });
      }
      // Every subsequent read (the "existing log" read, and tailLogForOrphan's
      // own initial size probe) finds no log file yet.
      throw new Error("ENOENT: no log file yet");
    });
    fsMock.watch.mockImplementation(() => ({ close: vi.fn() }));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(readCallCount).toBeGreaterThanOrEqual(3);

    killSpy.mockRestore();
  });

  it("falls back to pid 0 for the liveness probe and still finalizes when the entry vanished before the poll fired", () => {
    vi.useFakeTimers();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live6.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        id: "live-6",
        pid: 2020,
        command: "claude",
        args: [],
        runId: "run-14",
        stage: "planner",
        runtime: "claude-code",
        startedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    fsMock.watch.mockImplementation(() => ({ close: vi.fn() }));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Race: the entry is gone by the time the next poll tick runs.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "live-6",
    );
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();

    expect(killSpy).toHaveBeenCalledWith(0, 0);
    // finalizeOrphan is a no-op since the entry was already gone.
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("finalizeOrphan is a no-op when called for a processId that is not tracked", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, "/tmp/spool");

    expect(() =>
      (runner as unknown as { finalizeOrphan: (id: string) => void }).finalizeOrphan(
        "never-existed",
      ),
    ).not.toThrow();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it("cleanupProcess is a no-op when called for a processId that is not tracked", () => {
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    expect(() =>
      (
        runner as unknown as {
          cleanupProcess: (id: string, exitCode: number, durationMs: number) => void;
        }
      ).cleanupProcess("never-existed", 0, 10),
    ).not.toThrow();

    expect(logger.info).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it("finalizeOrphan best-effort swallows a manifest update failure", () => {
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    fsMock.readdirSync.mockReturnValue(["live4.json"]);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        id: "live-4",
        pid: 999,
        command: "claude",
        args: [],
        runId: "run-12",
        stage: "planner",
        runtime: "claude-code",
        startedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    fsMock.watch.mockImplementation(() => ({ close: vi.fn() }));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    vi.useFakeTimers();
    runner.rehydrateOrphans();

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("manifest unreadable at finalize");
    });

    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();

    killSpy.mockRestore();
  });
});
