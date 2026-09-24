import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  watch,
} from "node:fs";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("../../src/utils/ids.js", () => ({
  generateId: vi.fn(() => "fixed-process-id"),
}));

const SPOOL_DIR = "/spool/dir";

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

/** A fake ChildProcess: EventEmitter for 'error'/'close', with separate stdout/stderr emitters. */
function createFakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: ["--version"],
    cwd: "/work",
    timeoutMs: 10_000,
    ...overrides,
  };
}

let logger: ReturnType<typeof makeMockLogger>;
let emitter: ReturnType<typeof makeMockEmitter>;

beforeEach(() => {
  vi.clearAllMocks();
  logger = makeMockLogger();
  emitter = makeMockEmitter();

  vi.mocked(mkdirSync).mockReturnValue(undefined as never);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(createWriteStream).mockImplementation(
    () => ({ write: vi.fn(), end: vi.fn() }) as never,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner constructor", () => {
  it("ensures the spool directory exists (recursively) on construction", () => {
    new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    expect(mkdirSync).toHaveBeenCalledWith(resolve(SPOOL_DIR), { recursive: true });
  });

  it("falls back to the default spool directory when none is given", () => {
    new ProcessRunner("real", logger as never, emitter as never);

    expect(mkdirSync).toHaveBeenCalledWith(resolve(".foundry/processes"), { recursive: true });
  });
});

describe("ProcessRunner.execute() — mock mode", () => {
  it("throws when mock mode is enabled but no handler is configured", async () => {
    const runner = new ProcessRunner("mock", logger as never, emitter as never, SPOOL_DIR);

    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", logger as never, emitter as never, SPOOL_DIR);
    const result = { stdout: "hi", stderr: "", exitCode: 0, durationMs: 5, timedOut: false };
    const handler = vi.fn().mockResolvedValue(result);
    runner.setMockHandler(handler);

    const options = baseOptions();
    await expect(runner.execute(options)).resolves.toEqual(result);
    expect(handler).toHaveBeenCalledWith(options);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute() — real mode success path", () => {
  it("spawns the process with piped stdio and resolves with captured output on a clean exit", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions({ args: ["--version"], cwd: "/work" }));

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      ["--version"],
      expect.objectContaining({ cwd: "/work", stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(child.stdin.end).toHaveBeenCalled();
    expect(child.stdin.write).not.toHaveBeenCalled();

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
  });

  it("writes stdinData and ends stdin when provided", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions({ stdinData: "input payload" }));
    expect(child.stdin.write).toHaveBeenCalledWith("input payload");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) on a non-zero exit code when not timed out", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions());
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("defaults a null close code to exitCode 1", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an error event", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions());
    const err = new Error("ENOENT: spawn failed");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("skips manifest/log-stream creation (and later cleanup) when the child never gets a pid", async () => {
    const child = createFakeChild();
    (child as { pid: number | undefined }).pid = undefined;
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));

    // context + processId exist, but no pid -> entry is never registered.
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // cleanupProcess(processId, ...) is still invoked (processId was truthy) but
    // finds no matching entry and returns early — no completion event either.
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("does not throw and still buffers output when no emitter was configured", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);
    const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));
    child.stdout.emit("data", Buffer.from("no emitter here"));

    expect(runner.getProcessOutput("fixed-process-id")).toBe("no emitter here");

    child.emit("close", 0);
    await promise;
  });

  it("does not create a manifest, log stream, or emit process-started when no context is given", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions());
    child.emit("close", 0);
    await promise;

    expect(createWriteStream).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute() — real mode with process context", () => {
  it("writes a manifest, opens a log stream, and emits process:started when context is provided", async () => {
    const child = createFakeChild(999);
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));

    expect(createWriteStream).toHaveBeenCalledWith(
      join(resolve(SPOOL_DIR), "fixed-process-id.log"),
      { flags: "a" },
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      join(resolve(SPOOL_DIR), "fixed-process-id.json"),
      expect.stringContaining('"id": "fixed-process-id"'),
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      "fixed-process-id",
      "planner",
      "claude-code",
      "claude",
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "fixed-process-id",
      pid: 999,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    child.stdout.emit("data", Buffer.from("progress"));
    child.emit("close", 0);
    await promise;

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      "fixed-process-id",
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
    // The active process entry is removed once the process completes.
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("exposes buffered rolling output for an active process via getProcessOutput()", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));
    child.stdout.emit("data", Buffer.from("chunk-1"));

    expect(runner.getProcessOutput("fixed-process-id")).toBe("chunk-1");

    child.emit("close", 0);
    await promise;
  });

  it("truncates the in-memory rolling buffer once accumulated output exceeds the max size", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));

    // Rolling buffer max is 8KiB; push well past it in two chunks.
    child.stdout.emit("data", Buffer.from("a".repeat(6000)));
    child.stdout.emit("data", Buffer.from("b".repeat(6000) + "TAIL_MARKER"));

    const buffered = runner.getProcessOutput("fixed-process-id");
    expect(buffered).toHaveLength(8 * 1024);
    expect(buffered?.endsWith("TAIL_MARKER")).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("cleans up the active entry and records exitCode -1 when the child errors", async () => {
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ context }));
    const err = new Error("spawn EACCES");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      "fixed-process-id",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe("ProcessRunner.execute() — timeout handling", () => {
  it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError once it exits", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const context = { runId: "run-1", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000, context }));
    // catch early to avoid unhandled rejection warnings while we advance timers
    const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.killed = true;
    child.emit("close", null);

    await assertion;
    const rejected = await promise.catch((e: unknown) => e as AgentTimeoutError);
    expect(rejected.agent).toBe("claude-code/executor");
    expect(rejected.timeoutMs).toBe(1_000);
  });

  it("escalates to SIGKILL if the process has not exited 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // child never sets killed = true (stuck process) -> SIGKILL fallback fires
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await assertion;
  });

  it("does not escalate to SIGKILL if the process already exited (killed=true) before the grace period", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const assertion = expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    child.killed = true;
    child.emit("close", null);
    await assertion;

    vi.mocked(child.kill).mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("reads from the spool log file when the process is not active", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("logged output" as never);

    const output = runner.getProcessOutput("some-id");

    expect(existsSync).toHaveBeenCalledWith(join(resolve(SPOOL_DIR), "some-id.log"));
    expect(output).toBe("logged output");
  });

  it("returns null when no active entry and no log file exists", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(false);

    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("returns null when the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(runner.getProcessOutput("bad-id")).toBeNull();
  });

  it("truncates very large log file contents to the rolling buffer max", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const huge = "x".repeat(9000) + "TAIL";
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(huge as never);

    const output = runner.getProcessOutput("huge-id");
    expect(output).toHaveLength(8 * 1024);
    expect(output?.endsWith("TAIL")).toBe(true);
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("returns silently when the spool directory cannot be listed", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("ignores non-.json files and manifests that already have completedAt set", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(readdirSync).mockReturnValue(["notes.txt", "done.json"] as never);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ id: "done", pid: 1, completedAt: "2020-01-01T00:00:00.000Z" }) as never,
    );

    runner.rehydrateOrphans();

    // Only done.json should have been read (notes.txt filtered out by extension).
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when a manifest file cannot be parsed", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(readdirSync).mockReturnValue(["broken.json"] as never);
    vi.mocked(readFileSync).mockReturnValue("not valid json{" as never);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("stringifies a non-Error thrown value when a manifest fails to process", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    vi.mocked(readdirSync).mockReturnValue(["broken.json"] as never);
    vi.mocked(readFileSync).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "not an Error instance";
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json", error: "not an Error instance" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "dead-1",
      pid: 55555,
      command: "claude",
      args: [],
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "dead-1.log",
    };
    vi.mocked(readdirSync).mockReturnValue(["dead-1.json"] as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest) as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    try {
      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead-1", pid: 55555 }),
        "Orphaned agent process is dead, marking crashed",
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        join(resolve(SPOOL_DIR), "dead-1.json"),
        expect.stringContaining('"crashed": true'),
      );
      expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("rehydrates a still-alive orphan: registers it, seeds its buffer, and emits process:started", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "alive-1",
      pid: 555,
      command: "claude",
      args: ["--print"],
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "alive-1.log"),
    };
    vi.mocked(readdirSync).mockReturnValue(["alive-1.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("alive-1.json")) return JSON.stringify(manifest) as never;
      if (p.endsWith("alive-1.log")) return "existing log content" as never;
      throw new Error("ENOENT");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const watcherClose = vi.fn();
    vi.mocked(watch).mockReturnValue({ close: watcherClose } as never);

    try {
      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-1", pid: 555 }),
        "Rehydrating orphaned agent process",
      );
      expect(createWriteStream).toHaveBeenCalledWith(
        join(resolve(SPOOL_DIR), "alive-1.log"),
        { flags: "a" },
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-9",
        "alive-1",
        "executor",
        "claude-code",
        "claude",
      );
      expect(watch).toHaveBeenCalled();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive-1", pid: 555, runId: "run-9" });
      expect(runner.getProcessOutput("alive-1")).toBe("existing log content");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("tails file growth into the rolling buffer and finalizes the orphan once its pid disappears", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const logPath = join(resolve(SPOOL_DIR), "tail-1.log");
    const manifest = {
      id: "tail-1",
      pid: 777,
      command: "claude",
      args: [],
      runId: "run-tail",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };

    let logContent = "hello";
    vi.mocked(readdirSync).mockReturnValue(["tail-1.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown, encoding?: unknown) => {
      const p = String(path);
      if (p.endsWith("tail-1.json")) return JSON.stringify(manifest) as never;
      if (p.endsWith("tail-1.log")) {
        return (encoding ? logContent : Buffer.from(logContent)) as never;
      }
      throw new Error("ENOENT");
    });

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    const watcherClose = vi.fn();
    let watchCallback: (() => void) | undefined;
    vi.mocked(watch).mockImplementation((_path: unknown, cb: unknown) => {
      watchCallback = cb as () => void;
      return { close: watcherClose } as never;
    });

    try {
      runner.rehydrateOrphans();
      expect(watchCallback).toBeTypeOf("function");

      // Simulate the log file growing; the watcher callback should pick up the delta.
      logContent = "hello world MORE";
      watchCallback!();

      expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
        "run-tail",
        "tail-1",
        expect.stringContaining("world MORE"),
      );

      // Simulate the underlying process disappearing; the 5s poll interval detects it.
      alive = false;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(watcherClose).toHaveBeenCalled();
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-tail",
        "tail-1",
        "planner",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "tail-1", pid: 777 }),
        "Orphaned process has exited",
      );
      expect(runner.getActiveProcesses()).toHaveLength(0);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("swallows a read error inside the tail-watch callback without crashing or emitting output", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "tail-err",
      pid: 888,
      command: "claude",
      args: [],
      runId: "run-tail-err",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "tail-err.log"),
    };

    vi.mocked(readdirSync).mockReturnValue(["tail-err.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown, encoding?: unknown) => {
      const p = String(path);
      if (p.endsWith("tail-err.json")) return JSON.stringify(manifest) as never;
      if (p.endsWith("tail-err.log") && encoding) {
        throw new Error("read failed mid-tail");
      }
      if (p.endsWith("tail-err.log")) return Buffer.from("seed") as never;
      throw new Error("ENOENT");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    let watchCallback: (() => void) | undefined;
    vi.mocked(watch).mockImplementation((_path: unknown, cb: unknown) => {
      watchCallback = cb as () => void;
      return { close: vi.fn() } as never;
    });

    try {
      runner.rehydrateOrphans();
      expect(() => watchCallback!()).not.toThrow();
      expect(emitter.emitProcessOutput).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("tolerates a missing log file when seeding the initial tail size", () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "no-log-yet",
      pid: 111,
      command: "claude",
      args: [],
      runId: "run-no-log",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "no-log-yet.log"),
    };

    vi.mocked(readdirSync).mockReturnValue(["no-log-yet.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("no-log-yet.json")) return JSON.stringify(manifest) as never;
      // Log file does not exist yet for either the buffer seed or the tail seed.
      throw new Error("ENOENT: no such file");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.mocked(watch).mockReturnValue({ close: vi.fn() } as never);

    try {
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(1);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("closes the watcher and stops tailing once the active entry is gone by the time it fires", async () => {
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "vanished",
      pid: 222,
      command: "claude",
      args: [],
      runId: "run-vanished",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "vanished.log"),
    };

    vi.mocked(readdirSync).mockReturnValue(["vanished.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("vanished.json")) return JSON.stringify(manifest) as never;
      if (p.endsWith("vanished.log")) return Buffer.from("seed") as never;
      throw new Error("ENOENT");
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const watcherClose = vi.fn();
    let watchCallback: (() => void) | undefined;
    vi.mocked(watch).mockImplementation((_path: unknown, cb: unknown) => {
      watchCallback = cb as () => void;
      return { close: watcherClose } as never;
    });

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Directly remove the active entry (as finalizeOrphan would) and then fire
      // the watch callback: it should notice the entry is gone, close, and bail.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "vanished",
      );
      expect(() => watchCallback!()).not.toThrow();
      expect(watcherClose).toHaveBeenCalled();
      expect(emitter.emitProcessOutput).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("falls back to pid 0 in the poll check and no-ops finalizeOrphan when the entry is already gone", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "gone-1",
      pid: 444,
      command: "claude",
      args: [],
      runId: "run-gone",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "gone-1.log"),
    };

    vi.mocked(readdirSync).mockReturnValue(["gone-1.json"] as never);
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("gone-1.json")) return JSON.stringify(manifest) as never;
      if (p.endsWith("gone-1.log")) return Buffer.from("seed") as never;
      throw new Error("ENOENT");
    });
    const killCalls: Array<[number, number]> = [];
    let killCallCount = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      killCallCount += 1;
      killCalls.push([pid as number, signal as number]);
      // First call is rehydrateOrphans' own initial aliveness check — let it
      // succeed so the orphan is registered; subsequent poll calls fail.
      if (killCallCount === 1) return true;
      throw new Error("ESRCH");
    });
    const watcherClose = vi.fn();
    vi.mocked(watch).mockReturnValue({ close: watcherClose } as never);

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the entry directly (simulating some other path already cleaning it
      // up) so the poll interval's optional-chained pid lookup falls back to 0,
      // and finalizeOrphan subsequently finds nothing to finalize.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "gone-1",
      );

      await vi.advanceTimersByTimeAsync(5_000);

      expect(killCalls.some(([pid]) => pid === 0)).toBe(true);
      expect(watcherClose).toHaveBeenCalled();
      // finalizeOrphan found no entry, so it never emitted a completion event.
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it("swallows a manifest read error inside finalizeOrphan while still emitting process:completed", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);
    const manifest = {
      id: "final-err",
      pid: 321,
      command: "claude",
      args: [],
      runId: "run-final-err",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(resolve(SPOOL_DIR), "final-err.log"),
    };

    vi.mocked(readdirSync).mockReturnValue(["final-err.json"] as never);
    let jsonReadCount = 0;
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("final-err.json")) {
        jsonReadCount += 1;
        // First read (during rehydrate) succeeds; the finalize-time re-read fails.
        if (jsonReadCount === 1) return JSON.stringify(manifest) as never;
        throw new Error("manifest vanished");
      }
      if (p.endsWith("final-err.log")) return Buffer.from("seed") as never;
      throw new Error("ENOENT");
    });
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (!alive) throw new Error("ESRCH");
      return true;
    });
    vi.mocked(watch).mockReturnValue({ close: vi.fn() } as never);

    try {
      runner.rehydrateOrphans();
      alive = false;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-final-err",
        "final-err",
        "planner",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(runner.getActiveProcesses()).toHaveLength(0);
    } finally {
      killSpy.mockRestore();
    }
  });
});
