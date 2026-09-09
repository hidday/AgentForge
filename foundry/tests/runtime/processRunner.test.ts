import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { resolve, join } from "node:path";
import { AgentTimeoutError } from "../../src/utils/errors.js";

const { spawnMock, fsMocks, generateIdMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
    fsMocks: {
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(),
      readFileSync: vi.fn(),
      readdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(),
      watch: vi.fn(),
    },
    generateIdMock: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({
  mkdirSync: fsMocks.mkdirSync,
  createWriteStream: fsMocks.createWriteStream,
  readFileSync: fsMocks.readFileSync,
  readdirSync: fsMocks.readdirSync,
  writeFileSync: fsMocks.writeFileSync,
  existsSync: fsMocks.existsSync,
  watch: fsMocks.watch,
}));
vi.mock("../../src/utils/ids.js", () => ({ generateId: generateIdMock }));

// Imported after the mocks above so ProcessRunner picks up the mocked modules.
const { ProcessRunner } = await import("../../src/runtime/processRunner.js");

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

interface MockChild extends EventEmitter {
  pid?: number;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function createMockChild(pid: number | undefined): MockChild {
  const child = new EventEmitter() as MockChild;
  child.pid = pid;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

const SPOOL_DIR = "/spool";

beforeEach(() => {
  vi.clearAllMocks();
  fsMocks.createWriteStream.mockReturnValue({ write: vi.fn(), end: vi.fn() });
  fsMocks.existsSync.mockReturnValue(false);
  // Default manifest read for cleanupProcess()'s read-modify-write; tests
  // that care about specific manifest contents override this per-test.
  fsMocks.readFileSync.mockReturnValue("{}");
  let n = 0;
  generateIdMock.mockImplementation(() => `proc-${++n}`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("creates the (resolved) spool directory recursively", () => {
    new ProcessRunner("mock", makeLogger() as never, undefined, "my-spool");
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(resolve("my-spool"), { recursive: true });
  });

  it("defaults to .foundry/processes when no spoolDir is given", () => {
    new ProcessRunner("mock", makeLogger() as never);
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(resolve(".foundry/processes"), {
      recursive: true,
    });
  });
});

describe("ProcessRunner.execute -- mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, SPOOL_DIR);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 100 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and logs a debug line", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, SPOOL_DIR);
    const handler = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const options = { command: "claude", args: ["--print"], cwd: "/work", timeoutMs: 1000 };
    const result = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(result.stdout).toBe("ok");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", args: ["--print"], cwd: "/work" }),
      "Executing mock process",
    );
  });
});

describe("ProcessRunner.execute -- real mode (spawn)", () => {
  it("spawns with merged env/cwd/stdio, writes stdin data, and resolves with stdout/stderr on close", async () => {
    const child = createMockChild(111);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/work",
      env: { FOO: "bar" },
      timeoutMs: 5000,
      stdinData: "input data",
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/work",
        env: expect.objectContaining({ FOO: "bar", ...process.env }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith("input data");
    expect(child.stdin.end).toHaveBeenCalled();

    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    const [manifestPath, manifestJson] = fsMocks.writeFileSync.mock.calls[0] as [string, string];
    expect(manifestPath).toContain("proc-1.json");
    expect(JSON.parse(manifestJson)).toMatchObject({
      id: "proc-1",
      pid: 111,
      command: "echo",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      "proc-1",
      "planner",
      "claude-code",
      "echo",
    );

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      "proc-1",
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    // Manifest updated a second time on completion.
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it("falls back exitCode to 1 when the child closes with a null exit code (non-timeout)", async () => {
    const child = createMockChild(1212);
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/w", timeoutMs: 10_000 });
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 1 }),
      "Process completed",
    );
  });

  it("ends stdin without writing when no stdinData is provided", async () => {
    const child = createMockChild(9999);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/w", timeoutMs: 1000 });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("resolves normally (best-effort) even when the manifest cannot be re-read on completion", async () => {
    const child = createMockChild(1010);
    spawnMock.mockReturnValue(child);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("manifest file vanished");
    });
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/w",
      timeoutMs: 1000,
      context: { runId: "run-99", stage: "executor", runtime: "claude-code" },
    });

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // cleanupProcess's manifest re-read/update failed silently, but the
    // process:completed event still fires and getActiveProcesses cleans up.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-99",
      "proc-1",
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("does not track an active process or write a manifest when no context is given", async () => {
    const child = createMockChild(8888);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/w", timeoutMs: 1000 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not create an entry when context is given but the spawned child has no pid", async () => {
    const child = createMockChild(undefined);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/w",
      timeoutMs: 1000,
      context: { runId: "run-x", stage: "planner", runtime: "claude-code" },
    });
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    // close still resolves cleanly even though cleanupProcess finds no entry
    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("rejects and cleans up when the child process emits an error event", async () => {
    const child = createMockChild(222);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "bad-cmd",
      args: [],
      cwd: "/w",
      timeoutMs: 1000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    const spawnError = new Error("spawn ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("spawn ENOENT");
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-2",
      "proc-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("trims the rolling output buffer to the last ROLLING_BUFFER_MAX characters", async () => {
    const child = createMockChild(333);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/w",
      timeoutMs: 1000,
      context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
    });

    const bigChunk = "a".repeat(9000);
    child.stdout.emit("data", Buffer.from(bigChunk));
    const output = runner.getProcessOutput("proc-1");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toBe(bigChunk.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("throttles process:output emissions to once per 250ms and caps emitted chunks at 500 chars", async () => {
    vi.useFakeTimers();
    const child = createMockChild(444);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/w",
      timeoutMs: 10_000,
      context: { runId: "run-4", stage: "executor", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("chunk1"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    child.stdout.emit("data", Buffer.from("chunk2"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1); // still throttled

    vi.advanceTimersByTime(300);
    child.stdout.emit("data", Buffer.from("chunk3"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    const longChunk = "z".repeat(600);
    vi.advanceTimersByTime(300);
    child.stdout.emit("data", Buffer.from(longChunk));
    const lastCall = emitter.emitProcessOutput.mock.calls.at(-1)!;
    expect((lastCall[2] as string).length).toBe(500);
    expect(lastCall[2]).toBe(longChunk.slice(-500));

    child.emit("close", 0);
    await promise;
  });

  it("reports getActiveProcesses() with a growing elapsedMs while a process is running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const child = createMockChild(555);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/w",
      timeoutMs: 10_000,
      context: { runId: "run-5", stage: "planner", runtime: "claude-code" },
    });

    vi.advanceTimersByTime(2_000);
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "proc-1",
      pid: 555,
      command: "claude",
      runId: "run-5",
      stage: "planner",
      runtime: "claude-code",
      elapsedMs: 2_000,
    });

    child.emit("close", 0);
    await promise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("sends SIGTERM at timeout, then SIGKILL after a 5s grace period, and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const child = createMockChild(666);
    spawnMock.mockReturnValue(child);
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "sleep",
      args: ["100"],
      cwd: "/w",
      timeoutMs: 1_000,
      context: { runId: "run-6", stage: "executor", runtime: "claude-code" },
    });
    promise.catch(() => {
      /* asserted below via rejects */
    });

    vi.advanceTimersByTime(1_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    // child.killed stays false (simulating a stuck process) -> SIGKILL follows.
    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);

    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "sleep", timeoutMs: 1_000 }),
      "Process timed out",
    );
    // cleanup still runs (manifest + emitter) even though the promise rejects.
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-6",
      "proc-1",
      "executor",
      "claude-code",
      1,
      expect.any(Number),
    );
  });

  it("does not send SIGKILL if the process is already marked killed within the grace period", async () => {
    vi.useFakeTimers();
    const child = createMockChild(777);
    child.kill = vi.fn(() => {
      child.killed = true;
    });
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "sleep", args: [], cwd: "/w", timeoutMs: 1_000 });
    promise.catch(() => {});

    vi.advanceTimersByTime(1_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1); // no SIGKILL follow-up

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns null when the process is not active and has no log file", () => {
    fsMocks.existsSync.mockReturnValue(false);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads and tail-truncates the log file when the process is no longer active", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue("x".repeat(9000));
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const output = runner.getProcessOutput("finished-id");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(fsMocks.readFileSync).toHaveBeenCalledWith(join(SPOOL_DIR, "finished-id.log"), "utf-8");
  });

  it("returns null when the log file exists but cannot be read", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    expect(runner.getProcessOutput("unreadable-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently when the spool directory cannot be read", () => {
    fsMocks.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("ignores non-.json files and manifests that are already completed", () => {
    fsMocks.readdirSync.mockReturnValue(["notes.txt", "done.json"]);
    fsMocks.readFileSync.mockReturnValue(
      JSON.stringify({ id: "done-1", pid: 1, completedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const killSpy = vi.spyOn(process, "kill");
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    killSpy.mockRestore();
  });

  it("rehydrates a still-alive orphan: creates a log stream, tracks it, and emits process:started", () => {
    const manifest = {
      id: "orphan-1",
      pid: 9001,
      command: "claude",
      args: ["--print"],
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: join(SPOOL_DIR, "orphan-1.log"),
    };
    fsMocks.readdirSync.mockReturnValue(["orphan-1.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("orphan-1.json")) return JSON.stringify(manifest);
      if (path.endsWith("orphan-1.log")) return "existing log content";
      throw new Error("ENOENT");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const watcher = { close: vi.fn() };
    fsMocks.watch.mockReturnValue(watcher);
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(killSpy).toHaveBeenCalledWith(9001, 0);
    expect(fsMocks.createWriteStream).toHaveBeenCalledWith(
      join(SPOOL_DIR, "orphan-1.log"),
      { flags: "a" },
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      "orphan-1",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getProcessOutput("orphan-1")).toBe("existing log content");
    expect(fsMocks.watch).toHaveBeenCalledWith(join(SPOOL_DIR, "orphan-1.log"), expect.any(Function));

    killSpy.mockRestore();
  });

  it("leaves the rolling buffer empty when the orphan's log file cannot be read yet", () => {
    const manifest = {
      id: "orphan-nolog",
      pid: 9010,
      command: "claude",
      args: [],
      runId: "run-12",
      stage: "executor",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: join(SPOOL_DIR, "orphan-nolog.log"),
    };
    fsMocks.readdirSync.mockReturnValue(["orphan-nolog.json"]);
    fsMocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("orphan-nolog.json")) return JSON.stringify(manifest);
      throw new Error("ENOENT: no such log file yet");
    });
    fsMocks.watch.mockReturnValue({ close: vi.fn() });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("orphan-nolog")).toBe("");
    killSpy.mockRestore();
  });

  it("marks a dead orphan (pid no longer alive) as crashed and updates its manifest", () => {
    const manifest = {
      id: "dead-1",
      pid: 8000,
      command: "claude",
      args: [],
      runId: "run-8",
      stage: "planner",
      runtime: "claude-code",
      startedAt: "2026-01-01T00:00:00.000Z",
      logFile: join(SPOOL_DIR, "dead-1.log"),
    };
    fsMocks.readdirSync.mockReturnValue(["dead-1.json"]);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 8000 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    const [path, json] = fsMocks.writeFileSync.mock.calls[0] as [string, string];
    expect(path).toBe(join(SPOOL_DIR, "dead-1.json"));
    const written = JSON.parse(json) as { crashed: boolean; exitCode: number; completedAt: string };
    expect(written.crashed).toBe(true);
    expect(written.exitCode).toBe(-1);
    expect(written.completedAt).toBeTruthy();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file cannot be parsed", () => {
    fsMocks.readdirSync.mockReturnValue(["broken.json"]);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("disk read error");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json", error: "disk read error" }),
      "Failed to process manifest",
    );
  });

  it("stringifies a non-Error value thrown while processing a manifest", () => {
    fsMocks.readdirSync.mockReturnValue(["broken2.json"]);
    fsMocks.readFileSync.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain manifest failure";
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken2.json", error: "plain manifest failure" }),
      "Failed to process manifest",
    );
  });

  describe("orphan log tailing and finalization", () => {
    function setupAliveOrphan() {
      const manifest = {
        id: "orphan-2",
        pid: 9002,
        command: "claude",
        args: [],
        runId: "run-10",
        stage: "executor",
        runtime: "claude-code",
        startedAt: "2026-01-01T00:00:00.000Z",
        logFile: join(SPOOL_DIR, "orphan-2.log"),
      };
      fsMocks.readdirSync.mockReturnValue(["orphan-2.json"]);
      let logContent = "initial content";
      fsMocks.readFileSync.mockImplementation((path: string) => {
        if (path.endsWith("orphan-2.json")) return JSON.stringify(manifest);
        if (path.endsWith("orphan-2.log")) return logContent;
        throw new Error("ENOENT");
      });
      const watcher = { close: vi.fn() };
      fsMocks.watch.mockReturnValue(watcher);
      let alive = true;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        if (!alive) throw new Error("ESRCH");
        return true;
      });
      const emitter = makeEmitter();
      const logger = makeLogger();
      const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
      runner.rehydrateOrphans();

      return {
        runner,
        emitter,
        logger,
        watcher,
        killSpy,
        setAlive: (v: boolean) => {
          alive = v;
        },
        setLogContent: (v: string) => {
          logContent = v;
        },
        getWatchCallback: () => fsMocks.watch.mock.calls[0]![1] as () => void,
      };
    }

    it("appends new log content to the rolling buffer when fs.watch fires", () => {
      const { setLogContent, getWatchCallback, runner } = setupAliveOrphan();
      setLogContent("initial content -- and now some more output appended");

      getWatchCallback()();

      expect(runner.getProcessOutput("orphan-2")).toBe(
        "initial content -- and now some more output appended",
      );
    });

    it("does not append anything when fs.watch fires but the log has not grown", () => {
      const { getWatchCallback, runner } = setupAliveOrphan();
      // logContent stays at "initial content" (unchanged) -- content.length is
      // not greater than lastSize, so the `if (content.length > lastSize)`
      // branch must be skipped.
      const before = runner.getProcessOutput("orphan-2");

      getWatchCallback()();

      expect(runner.getProcessOutput("orphan-2")).toBe(before);
    });

    it("falls back to pid 0 when polling a processId whose entry has already been removed", () => {
      vi.useFakeTimers();
      const { runner, killSpy } = setupAliveOrphan();

      // Force the poll tick to observe a missing entry (defensive branch:
      // `this.activeProcesses.get(processId)?.pid ?? 0`) without going through
      // the normal finalize path, by deleting straight from the internal map.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "orphan-2",
      );

      expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
      expect(killSpy).toHaveBeenCalledWith(0, 0);

      killSpy.mockRestore();
    });

    it("finalizeOrphan() is a no-op when the entry is already gone by the time it runs", () => {
      vi.useFakeTimers();
      const { runner, killSpy, setAlive, emitter } = setupAliveOrphan();

      // Remove the entry out-of-band, then make the next poll tick fail so the
      // interval's catch handler calls finalizeOrphan() for an id that no
      // longer has a tracked entry -- it must return early without crashing
      // or emitting a (meaningless) second completion event.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "orphan-2",
      );
      setAlive(false);

      expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();

      killSpy.mockRestore();
    });

    it("does nothing (no crash) when fs.watch fires but the log cannot be re-read", () => {
      fsMocks.readFileSync.mockReset();
      const { getWatchCallback } = (() => {
        // Re-run setup but make the log re-read throw on the watch callback.
        const manifest = {
          id: "orphan-3",
          pid: 9003,
          command: "claude",
          args: [],
          runId: "run-11",
          stage: "executor",
          runtime: "claude-code",
          startedAt: "2026-01-01T00:00:00.000Z",
          logFile: join(SPOOL_DIR, "orphan-3.log"),
        };
        fsMocks.readdirSync.mockReturnValue(["orphan-3.json"]);
        let callCount = 0;
        fsMocks.readFileSync.mockImplementation((path: string) => {
          if (path.endsWith("orphan-3.json")) return JSON.stringify(manifest);
          if (path.endsWith("orphan-3.log")) {
            callCount += 1;
            if (callCount === 1) return "initial";
            throw new Error("log rotated away");
          }
          throw new Error("ENOENT");
        });
        fsMocks.watch.mockReturnValue({ close: vi.fn() });
        vi.spyOn(process, "kill").mockImplementation(() => true);
        const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
        runner.rehydrateOrphans();
        return { getWatchCallback: () => fsMocks.watch.mock.calls[0]![1] as () => void };
      })();

      expect(() => getWatchCallback()()).not.toThrow();
    });

    it("closes the watcher and returns early if the entry was already removed", () => {
      vi.useFakeTimers();
      const { watcher, getWatchCallback, runner, killSpy, setAlive } = setupAliveOrphan();

      setAlive(false);
      // Advance past the 5s poll interval so finalizeOrphan() removes the entry.
      vi.advanceTimersByTime(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(0);

      watcher.close.mockClear();
      getWatchCallback()();
      expect(watcher.close).toHaveBeenCalledTimes(1);

      killSpy.mockRestore();
    });

    it("finalizes an orphan once its process is no longer alive: closes watcher, updates manifest, emits completion", () => {
      vi.useFakeTimers();
      const { runner, emitter, logger, watcher, killSpy, setAlive } = setupAliveOrphan();

      fsMocks.writeFileSync.mockClear();
      setAlive(false);
      vi.advanceTimersByTime(5_000);

      expect(watcher.close).toHaveBeenCalledTimes(1);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-10",
        "orphan-2",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-2" }),
        "Orphaned process has exited",
      );
      expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);

      killSpy.mockRestore();
    });

    it("still emits process:completed when finalizeOrphan's manifest re-read fails (best-effort)", () => {
      vi.useFakeTimers();
      const { runner, emitter, watcher, killSpy, setAlive } = setupAliveOrphan();

      // Simulate the manifest file disappearing before finalization re-reads it.
      fsMocks.readFileSync.mockImplementation(() => {
        throw new Error("manifest gone");
      });
      setAlive(false);
      vi.advanceTimersByTime(5_000);

      expect(watcher.close).toHaveBeenCalledTimes(1);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-10",
        "orphan-2",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );

      killSpy.mockRestore();
    });

    it("keeps polling (does not finalize) while the orphan process remains alive", () => {
      vi.useFakeTimers();
      const { runner, emitter } = setupAliveOrphan();

      vi.advanceTimersByTime(5_000);
      vi.advanceTimersByTime(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    });
  });
});
