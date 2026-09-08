import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  watch,
} from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

/** Minimal EventEmitter-based stand-in for node's ChildProcess. */
function createFakeChild(pid: number | undefined = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number | undefined;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn(() => true);
  return child;
}

// In-memory virtual filesystem backing the mocked node:fs calls, so manifest
// read/write round-trips behave like a real spool directory would.
let fakeFiles: Map<string, string>;

function lastWriteStream() {
  const results = vi.mocked(createWriteStream).mock.results;
  return results[results.length - 1]!.value as { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeFiles = new Map();
  vi.mocked(mkdirSync).mockImplementation(() => undefined as never);
  vi.mocked(writeFileSync).mockImplementation((path, data) => {
    fakeFiles.set(String(path), String(data));
  });
  vi.mocked(readFileSync).mockImplementation((path) => {
    const content = fakeFiles.get(String(path));
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file, open '${String(path)}'`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return content;
  });
  vi.mocked(existsSync).mockImplementation((path) => fakeFiles.has(String(path)));
  vi.mocked(readdirSync).mockReturnValue([] as never);
  vi.mocked(createWriteStream).mockImplementation(
    () => ({ write: vi.fn(), end: vi.fn() }) as never,
  );
  vi.mocked(watch).mockImplementation(() => ({ close: vi.fn() }) as never);
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const baseOptions: ProcessSpawnOptions = {
  command: "echo",
  args: ["hi"],
  cwd: "/tmp",
  timeoutMs: 5000,
};

describe("ProcessRunner constructor", () => {
  it("ensures the spool directory exists at the default location", () => {
    const logger = makeMockLogger();
    new ProcessRunner("mock", logger as never);
    expect(mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".foundry/processes"),
      { recursive: true },
    );
  });

  it("ensures the spool directory exists at a custom location", () => {
    const logger = makeMockLogger();
    new ProcessRunner("mock", logger as never, undefined, "/tmp/custom-spool");
    expect(mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("custom-spool"),
      { recursive: true },
    );
  });
});

describe("ProcessRunner.execute — mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    await expect(runner.execute(baseOptions)).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and logs at debug level", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    const handlerResult = {
      stdout: "mocked output",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(handlerResult);
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions);

    expect(handler).toHaveBeenCalledWith(baseOptions);
    expect(result).toEqual(handlerResult);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"], cwd: "/tmp" }),
      "Executing mock process",
    );
  });

  it("propagates a rejection from the mock handler", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never);
    runner.setMockHandler(vi.fn().mockRejectedValue(new Error("handler blew up")));

    await expect(runner.execute(baseOptions)).rejects.toThrow("handler blew up");
  });
});

describe("ProcessRunner.execute — real mode, basic lifecycle", () => {
  it("resolves with concatenated stdout/stderr, exit code, and timedOut=false", async () => {
    const child = createFakeChild(111);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute(baseOptions);

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
    expect(spawn).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("defaults exitCode to 1 when close reports a null code", async () => {
    const child = createFakeChild(112);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData and ends stdin when provided", async () => {
    const child = createFakeChild(113);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, stdinData: "the prompt" });
    child.emit("close", 0);
    await promise;

    expect(child.stdin.write).toHaveBeenCalledWith("the prompt");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("merges extra env vars on top of process.env", async () => {
    const child = createFakeChild(114);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, env: { FOO: "bar" } });
    child.emit("close", 0);
    await promise;

    const spawnOptions = vi.mocked(spawn).mock.calls[0]![2] as { env: Record<string, string> };
    expect(spawnOptions.env.FOO).toBe("bar");
  });

  it("rejects with the child's error event", async () => {
    const child = createFakeChild(115);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute(baseOptions);
    const spawnErr = new Error("ENOENT: command not found");
    child.emit("error", spawnErr);

    await expect(promise).rejects.toBe(spawnErr);
  });

  it("logs at info level on successful completion", async () => {
    const child = createFakeChild(116);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", 0);
    await promise;

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });
});

describe("ProcessRunner.execute — process tracking via context", () => {
  const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

  it("creates an active process entry, writes a manifest, and emits process:started when context + pid are present", async () => {
    const child = createFakeChild(200);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({ ...baseOptions, context });

    // While still running, the process should show up as active.
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 200,
      command: "echo",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      "echo",
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`${active[0]!.id}.json`),
      expect.stringContaining('"pid": 200'),
    );

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    expect(lastWriteStream().end).toHaveBeenCalled();
  });

  it("does not track the process when context is provided but the child has no pid", async () => {
    const child = createFakeChild(1);
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({ ...baseOptions, context });
    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("does not track the process when no context is provided", async () => {
    const child = createFakeChild(201);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute(baseOptions);
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("tolerates a manifest that vanishes before cleanup (best-effort update)", async () => {
    const child = createFakeChild(203);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({ ...baseOptions, context });
    const [active] = runner.getActiveProcesses();

    // Manifest file disappears before the process completes, so cleanupProcess's
    // best-effort readFileSync/writeFileSync round-trip fails silently.
    fakeFiles.delete(`/tmp/foundry-spool-path-placeholder`); // no-op safety, real deletion below
    for (const key of [...fakeFiles.keys()]) {
      if (key.endsWith(`${active!.id}.json`)) fakeFiles.delete(key);
    }

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active!.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("cleans up and emits process:completed with exitCode -1 on a child error event", async () => {
    const child = createFakeChild(202);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({ ...baseOptions, context });
    const active = runner.getActiveProcesses();
    const processId = active[0]!.id;

    const spawnErr = new Error("spawn failed");
    child.emit("error", spawnErr);

    await expect(promise).rejects.toBe(spawnErr);
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns the live rolling buffer for an active process", async () => {
    const child = createFakeChild(300);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-2", stage: "executor", runtime: "codex" },
    });
    const [active] = runner.getActiveProcesses();
    child.stdout.emit("data", Buffer.from("partial output so far"));

    expect(runner.getProcessOutput(active!.id)).toBe("partial output so far");

    child.emit("close", 0);
    await promise;
  });

  it("reads from the spool log file when the process is no longer active", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fakeFiles.set("/tmp/spool/proc-1.log", "a".repeat(9000) + "[TAIL]");

    const output = runner.getProcessOutput("proc-1");
    expect(output).not.toBeNull();
    expect(output!.length).toBe(8 * 1024);
    expect(output).toContain("[TAIL]");
  });

  it("returns null when neither an active entry nor a log file exists", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);
    expect(runner.getProcessOutput("no-such-process")).toBeNull();
  });

  it("returns null when the log file exists but reading it throws", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(runner.getProcessOutput("unreadable")).toBeNull();
  });
});

describe("ProcessRunner — output buffering and throttled emission", () => {
  it("truncates the rolling buffer to the last 8KB", async () => {
    const child = createFakeChild(400);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-3", stage: "executor", runtime: "codex" },
    });
    const [active] = runner.getActiveProcesses();

    const bigChunk = "x".repeat(9000) + "[END]";
    child.stdout.emit("data", Buffer.from(bigChunk));

    const buffered = runner.getProcessOutput(active!.id)!;
    expect(buffered.length).toBe(8 * 1024);
    expect(buffered).toContain("[END]");

    child.emit("close", 0);
    await promise;
  });

  it("emits the first chunk immediately, throttles a rapid second chunk, then emits again after the throttle window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const child = createFakeChild(401);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-4", stage: "executor", runtime: "codex" },
    });

    child.stdout.emit("data", Buffer.from("first chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    // Immediately-following chunk within the 250ms throttle window is dropped.
    child.stdout.emit("data", Buffer.from("second chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_300);
    child.stdout.emit("data", Buffer.from("third chunk"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

    child.emit("close", 0);
    await promise;
  });

  it("slices an emitted chunk to its last 500 characters when longer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);

    const child = createFakeChild(402);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-5", stage: "executor", runtime: "codex" },
    });

    const longChunk = "y".repeat(600) + "[MARK]";
    child.stdout.emit("data", Buffer.from(longChunk));

    const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(emittedChunk.length).toBe(500);
    expect(emittedChunk).toContain("[MARK]");

    child.emit("close", 0);
    await promise;
  });

  it("does nothing when no emitter is configured", async () => {
    const child = createFakeChild(403);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({
      ...baseOptions,
      context: { runId: "run-6", stage: "executor", runtime: "codex" },
    });
    child.stdout.emit("data", Buffer.from("no emitter configured"));
    child.emit("close", 0);

    await expect(promise).resolves.toBeDefined();
  });
});

describe("ProcessRunner — timeout handling", () => {
  const context = { runId: "run-t", stage: "executor", runtime: "codex" };

  it("sends SIGTERM at the timeout and escalates to SIGKILL if the process is still alive after the grace period", async () => {
    vi.useFakeTimers();
    const child = createFakeChild(500);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1000, context });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect(err.agent).toBe("codex/executor");
    expect(err.timeoutMs).toBe(1000);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not escalate to SIGKILL when the process is already killed after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = createFakeChild(501);
    child.kill.mockImplementation(() => {
      child.killed = true;
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1000, context });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses the raw command as the timeout error label when no context is provided", async () => {
    vi.useFakeTimers();
    const child = createFakeChild(502);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    child.emit("close", 1);

    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(AgentTimeoutError);
    expect(err.agent).toBe("echo");
  });

  it("does not reject as a timeout when the process closes normally before the deadline", async () => {
    vi.useFakeTimers();
    const child = createFakeChild(503);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never);

    const promise = runner.execute({ ...baseOptions, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", 0);

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);

    // Advancing well past the timeout afterwards must not throw or double-kill.
    await vi.advanceTimersByTimeAsync(10000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns silently when the spool directory can't be listed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("ENOENT: spool dir missing");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores non-.json files and manifests that already completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");
    fakeFiles.set(
      "/tmp/spool/done.json",
      JSON.stringify({
        id: "done",
        pid: 999,
        command: "echo",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "codex",
        startedAt: new Date().toISOString(),
        logFile: "/tmp/spool/done.log",
        completedAt: new Date().toISOString(),
      }),
    );
    vi.mocked(readdirSync).mockReturnValue(["done.json", "notes.txt"] as never);

    runner.rehydrateOrphans();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("rehydrates a still-alive orphan: restores buffer, tracks it, and emits process:started", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    const manifest = {
      id: "orphan-1",
      pid: 777,
      command: "claude",
      args: ["--print"],
      runId: "run-orphan",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/spool/orphan-1.log",
    };
    fakeFiles.set("/tmp/spool/orphan-1.json", JSON.stringify(manifest));
    fakeFiles.set("/tmp/spool/orphan-1.log", "previously buffered output");
    vi.mocked(readdirSync).mockReturnValue(["orphan-1.json"] as never);
    killSpy.mockImplementation(() => true as never);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-1", pid: 777 }),
      "Rehydrating orphaned agent process",
    );
    expect(createWriteStream).toHaveBeenCalledWith("/tmp/spool/orphan-1.log", { flags: "a" });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-orphan",
      "orphan-1",
      "planner",
      "claude-code",
      "claude",
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "orphan-1", pid: 777 });
    expect(runner.getProcessOutput("orphan-1")).toBe("previously buffered output");
    expect(watch).toHaveBeenCalledWith("/tmp/spool/orphan-1.log", expect.any(Function));
  });

  it("tolerates a missing log file when rehydrating (empty rolling buffer)", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    const manifest = {
      id: "orphan-2",
      pid: 778,
      command: "codex",
      args: [],
      runId: "run-orphan-2",
      stage: "reviewer",
      runtime: "codex",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/spool/orphan-2.log",
    };
    fakeFiles.set("/tmp/spool/orphan-2.json", JSON.stringify(manifest));
    // No log file registered in fakeFiles -> readFileSync throws ENOENT.
    vi.mocked(readdirSync).mockReturnValue(["orphan-2.json"] as never);
    killSpy.mockImplementation(() => true as never);

    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("orphan-2")).toBe("");
  });

  it("marks a dead orphan as crashed and persists the manifest", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");

    const manifest = {
      id: "orphan-3",
      pid: 779,
      command: "cursor",
      args: [],
      runId: "run-orphan-3",
      stage: "planner",
      runtime: "cursor",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/spool/orphan-3.log",
    };
    fakeFiles.set("/tmp/spool/orphan-3.json", JSON.stringify(manifest));
    vi.mocked(readdirSync).mockReturnValue(["orphan-3.json"] as never);
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH: no such process");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-3", pid: 779 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    const persisted = JSON.parse(fakeFiles.get("/tmp/spool/orphan-3.json")!);
    expect(persisted.crashed).toBe(true);
    expect(persisted.exitCode).toBe(-1);
    expect(persisted.completedAt).toBeDefined();
  });

  it("logs a warning and continues when a manifest file is unreadable or malformed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, "/tmp/spool");

    // "missing.json" is never registered in fakeFiles -> readFileSync throws.
    // "corrupt.json" has unparsable JSON content.
    fakeFiles.set("/tmp/spool/corrupt.json", "{not valid json");
    vi.mocked(readdirSync).mockReturnValue([
      "missing.json",
      "corrupt.json",
      "weird-throw.json",
    ] as never);

    const originalReadFileSync = vi.mocked(readFileSync).getMockImplementation()!;
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("weird-throw.json")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "a non-Error thrown value";
      }
      return originalReadFileSync(path);
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "missing.json" }),
      "Failed to process manifest",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "weird-throw.json", error: "a non-Error thrown value" }),
      "Failed to process manifest",
    );
  });
});

describe("ProcessRunner — orphan log tailing and finalization", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  function rehydrateOneOrphan(logger: ReturnType<typeof makeMockLogger>, emitter: ReturnType<typeof makeMockEmitter>) {
    const runner = new ProcessRunner("real", logger as never, emitter as never, "/tmp/spool");
    const manifest = {
      id: "tail-1",
      pid: 888,
      command: "claude",
      args: [],
      runId: "run-tail",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "/tmp/spool/tail-1.log",
    };
    fakeFiles.set("/tmp/spool/tail-1.json", JSON.stringify(manifest));
    fakeFiles.set("/tmp/spool/tail-1.log", "initial log content");
    vi.mocked(readdirSync).mockReturnValue(["tail-1.json"] as never);
    runner.rehydrateOrphans();
    return runner;
  }

  it("appends new log content to the buffer when the watched file grows", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = rehydrateOneOrphan(logger, emitter);

    const watchCallback = vi.mocked(watch).mock.calls[0]![1] as () => void;

    fakeFiles.set("/tmp/spool/tail-1.log", "initial log content MORE APPENDED TEXT");
    watchCallback();

    expect(runner.getProcessOutput("tail-1")).toBe("initial log content MORE APPENDED TEXT");
  });

  it("closes the watcher without error when the tracked entry is already gone", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    vi.useFakeTimers();
    rehydrateOneOrphan(logger, emitter);

    const watcherHandle = vi.mocked(watch).mock.results[0]!.value as { close: ReturnType<typeof vi.fn> };
    const watchCallback = vi.mocked(watch).mock.calls[0]![1] as () => void;

    // Simulate the process having already finalized (e.g. via the poll interval),
    // which itself calls watcher.close() once.
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    vi.advanceTimersByTime(5000);
    expect(watcherHandle.close).toHaveBeenCalledTimes(1);

    // A subsequent fs.watch callback firing after the entry is gone should
    // close the (already-closed) watcher again via its own guard, not throw.
    watchCallback();
    expect(watcherHandle.close).toHaveBeenCalledTimes(2);
  });

  it("ignores a transient read error inside the watch callback", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    rehydrateOneOrphan(logger, emitter);

    const watchCallback = vi.mocked(watch).mock.calls[0]![1] as () => void;
    const originalImpl = vi.mocked(readFileSync).getMockImplementation()!;
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("transient read error");
    });

    expect(() => watchCallback()).not.toThrow();
    vi.mocked(readFileSync).mockImplementation(originalImpl);
  });

  it("finalizes the orphan once the poll interval detects the process has died", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    vi.useFakeTimers();
    const runner = rehydrateOneOrphan(logger, emitter);

    expect(runner.getActiveProcesses()).toHaveLength(1);

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH: process gone");
    });
    vi.advanceTimersByTime(5000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-tail",
      "tail-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "tail-1", pid: 888 }),
      "Orphaned process has exited",
    );

    const persisted = JSON.parse(fakeFiles.get("/tmp/spool/tail-1.json")!);
    expect(persisted.exitCode).toBe(-1);
    expect(persisted.completedAt).toBeDefined();
  });

  it("keeps polling without finalizing while the orphan process is still alive", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    vi.useFakeTimers();
    const runner = rehydrateOneOrphan(logger, emitter);

    killSpy.mockImplementation(() => true as never);
    vi.advanceTimersByTime(5000);

    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("tolerates the manifest being unreadable when finalizing an orphan", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    vi.useFakeTimers();
    const runner = rehydrateOneOrphan(logger, emitter);

    // Remove the manifest file so the best-effort update inside finalizeOrphan fails.
    fakeFiles.delete("/tmp/spool/tail-1.json");

    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });
});
