import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { join } from "node:path";

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

const SPOOL_DIR = "/fake/spool";

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

function makeFakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
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
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function makeFakeWriteStream() {
  return { write: vi.fn(), end: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mkdirSync).mockReturnValue(undefined as never);
  vi.mocked(createWriteStream).mockImplementation(() => makeFakeWriteStream() as never);
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdirSync).mockReturnValue([] as never);
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("ENOENT: no such file");
  });
  vi.mocked(watch).mockImplementation(() => ({ close: vi.fn() }) as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner.execute() dispatch", () => {
  it("throws when mock mode is enabled but no handler is configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the injected mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never);
    const mockResult = {
      stdout: "hi",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(mockResult);
    runner.setMockHandler(handler);

    const result = await runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/",
      timeoutMs: 1000,
    });

    expect(result).toBe(mockResult);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", args: ["hi"] }),
    );
    expect(logger.debug).toHaveBeenCalled();
  });

  it("dispatches to real process spawning in real mode", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/", timeoutMs: 5000 });
    child.emit("close", 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      "echo",
      [],
      expect.objectContaining({ cwd: "/", stdio: ["pipe", "pipe", "pipe"] }),
    );
  });
});

describe("ProcessRunner.executeReal() — basic lifecycle (no context)", () => {
  it("resolves with collected stdout/stderr and exitCode on close", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: ["hi"], cwd: "/", timeoutMs: 5000 });
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
  });

  it("defaults exitCode to 1 when close code is null", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/", timeoutMs: 5000 });
    child.emit("close", null);
    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("without a context, never tracks an active process or writes a manifest", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/", timeoutMs: 5000 });
    expect(runner.getActiveProcesses()).toEqual([]);
    child.emit("close", 0);
    await promise;

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  it("writes stdinData to the child and closes stdin", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "echo",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      stdinData: "feed me",
    });
    expect(child.stdin.write).toHaveBeenCalledWith("feed me");
    expect(child.stdin.end).toHaveBeenCalled();
    child.emit("close", 0);
    await promise;
  });

  it("closes stdin without writing when no stdinData is given", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "echo", args: [], cwd: "/", timeoutMs: 5000 });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
    child.emit("close", 0);
    await promise;
  });

  it("rejects with the child's error event and records exitCode -1", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "bogus", args: [], cwd: "/", timeoutMs: 5000 });
    const err = new Error("spawn bogus ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toThrow("spawn bogus ENOENT");
  });
});

describe("ProcessRunner.executeReal() — context tracking, manifests, and dashboard events", () => {
  const context = { runId: "run-1", stage: "planner", runtime: "claude-code" };

  it("tracks the active process, writes a manifest, and emits process:started", async () => {
    const child = makeFakeChild(555);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logStream = makeFakeWriteStream();
    vi.mocked(createWriteStream).mockReturnValue(logStream as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/wd",
      timeoutMs: 5000,
      context,
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 555,
      command: "claude",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.id).toBe("string");
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [manifestPath, manifestBody] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(String(manifestPath)).toContain(active[0]!.id);
    const manifest = JSON.parse(manifestBody as string);
    expect(manifest).toMatchObject({
      id: active[0]!.id,
      pid: 555,
      command: "claude",
      args: ["--print"],
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });
    expect(manifest.completedAt).toBeUndefined();

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "planner",
      "claude-code",
      "claude",
    );

    child.emit("close", 0);
    await promise;
  });

  it("writes output chunks to the log stream and exposes them via getProcessOutput while active", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logStream = makeFakeWriteStream();
    vi.mocked(createWriteStream).mockReturnValue(logStream as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context,
    });
    const id = runner.getActiveProcesses()[0]!.id;

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(logStream.write).toHaveBeenCalledWith(Buffer.from("partial output"));
    expect(runner.getProcessOutput(id)).toBe("partial output");

    child.emit("close", 0);
    await promise;
  });

  it("finalizes the process on close: removes it from active tracking, updates the manifest, ends the log stream, and emits process:completed", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logStream = makeFakeWriteStream();
    vi.mocked(createWriteStream).mockReturnValue(logStream as never);
    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context,
    });
    const id = runner.getActiveProcesses()[0]!.id;

    // Allow cleanupProcess to successfully re-read the manifest it just wrote.
    const [, firstBody] = vi.mocked(writeFileSync).mock.calls[0]!;
    vi.mocked(readFileSync).mockReturnValue(firstBody as never);

    child.emit("close", 3);
    const result = await promise;

    expect(result.exitCode).toBe(3);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(logStream.end).toHaveBeenCalled();

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    const [, secondBody] = vi.mocked(writeFileSync).mock.calls[1]!;
    const manifest = JSON.parse(secondBody as string);
    expect(manifest.exitCode).toBe(3);
    expect(typeof manifest.completedAt).toBe("string");
    expect(typeof manifest.durationMs).toBe("number");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      3,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: id, exitCode: 3 }),
      "Agent process completed",
    );
  });

  it("tolerates a manifest read failure during cleanup (best-effort update)", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context,
    });
    // readFileSync continues to throw (default mock) when cleanupProcess tries to
    // re-read the manifest it just wrote — the update must be skipped silently.
    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // Only the initial manifest write happened; the completion rewrite is skipped
    // because reading it back failed.
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessCompleted).toHaveBeenCalled();
  });

  it("on child error with a context, cleans up the active process with exitCode -1", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context,
    });
    const id = runner.getActiveProcesses()[0]!.id;

    child.emit("error", new Error("boom"));
    await expect(promise).rejects.toThrow("boom");

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });
});

describe("ProcessRunner.executeReal() — timeout handling", () => {
  it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeLogger();
    const context = { runId: "run-1", stage: "executor", runtime: "claude-code" };
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 1000,
      context,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    await expect(promise).rejects.toThrow(/executor/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL after 5s if the process has not died", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    child.kill = vi.fn(); // does not flip `killed`
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "claude", args: [], cwd: "/", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("does not escalate to SIGKILL if the process died after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild(); // kill() flips `killed` to true
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "claude", args: [], cwd: "/", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("uses the bare command as the timeout label when no context is given", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({ command: "mycli", args: [], cwd: "/", timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", 0);

    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(AgentTimeoutError);
      expect((err as AgentTimeoutError).agent).toBe("mycli");
    });
  });
});

describe("ProcessRunner — rolling output buffer", () => {
  it("truncates the buffer to ROLLING_BUFFER_MAX, keeping only the tail", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    // No emitter: appendToBuffer only exercises the truncation branch.
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context: { runId: "r", stage: "s", runtime: "claude-code" },
    });
    const id = runner.getActiveProcesses()[0]!.id;

    child.stdout.emit("data", Buffer.from("A".repeat(5000)));
    child.stdout.emit("data", Buffer.from("B".repeat(5000)));

    const buffer = runner.getProcessOutput(id)!;
    expect(buffer.length).toBe(8 * 1024);
    expect(buffer.endsWith("B")).toBe(true);
    expect(buffer.startsWith("A")).toBe(true);
    expect(buffer.includes("A".repeat(3192))).toBe(true);

    child.emit("close", 0);
    await promise;
  });

  it("does not grow the buffer past the max with output under the limit", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 5000,
      context: { runId: "r", stage: "s", runtime: "claude-code" },
    });
    const id = runner.getActiveProcesses()[0]!.id;
    child.stdout.emit("data", Buffer.from("short"));
    expect(runner.getProcessOutput(id)).toBe("short");

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner — output throttling to the dashboard emitter", () => {
  it("emits the first chunk immediately, suppresses a chunk within the throttle window, then emits again after it elapses", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 50_000,
      context: { runId: "r1", stage: "s", runtime: "claude-code" },
    });
    const id = runner.getActiveProcesses()[0]!.id;

    child.stdout.emit("data", Buffer.from("first"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith("r1", id, "first");

    child.stdout.emit("data", Buffer.from("second"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("third"));
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
    expect(emitter.emitProcessOutput).toHaveBeenLastCalledWith("r1", id, "third");

    child.emit("close", 0);
    await promise;
  });

  it("emits only the last 500 characters of an oversized chunk", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, SPOOL_DIR);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/",
      timeoutMs: 50_000,
      context: { runId: "r1", stage: "s", runtime: "claude-code" },
    });

    const big = "X".repeat(400) + "Y".repeat(200);
    child.stdout.emit("data", Buffer.from(big));
    const [, , chunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(chunk).toHaveLength(500);
    expect(chunk).toBe(big.slice(-500));

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.getProcessOutput() fallback to the log file", () => {
  it("returns null when there is no active process and no log file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(false);
    expect(runner.getProcessOutput("missing-id")).toBeNull();
  });

  it("reads and tail-truncates the on-disk log when the process is no longer active", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(true);
    const longContent = "Z".repeat(9000);
    vi.mocked(readFileSync).mockReturnValue(longContent as never);

    const output = runner.getProcessOutput("done-id");
    expect(output).toHaveLength(8 * 1024);
    expect(output).toBe(longContent.slice(-8 * 1024));
  });

  it("returns null if the log file exists but cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(runner.getProcessOutput("done-id")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  it("does nothing when the spool directory cannot be listed", () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("only considers .json manifest files", () => {
    vi.mocked(readdirSync).mockReturnValue(["notes.txt", "readme.md"] as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, SPOOL_DIR);
    runner.rehydrateOrphans();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("skips manifests that are already marked completed", () => {
    vi.mocked(readdirSync).mockReturnValue(["done.json"] as never);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        id: "done-1",
        pid: 1,
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: "x.log",
        completedAt: new Date().toISOString(),
      }) as never,
    );
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);
    runner.rehydrateOrphans();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("marks a dead orphan (pid no longer alive) as crashed and rewrites its manifest", () => {
    const manifest = {
      id: "dead-1",
      pid: 9999,
      command: "claude",
      args: ["--print"],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(SPOOL_DIR, "dead-1.log"),
    };
    vi.mocked(readdirSync).mockReturnValue(["dead-1.json"] as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest) as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: 9999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, body] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(String(path)).toContain("dead-1.json");
    const updated = JSON.parse(body as string);
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(typeof updated.completedAt).toBe("string");
    expect(runner.getActiveProcesses()).toEqual([]);

    killSpy.mockRestore();
  });

  it("logs a warning and continues when a manifest file is corrupt", () => {
    vi.mocked(readdirSync).mockReturnValue(["bad.json", "dead-1.json"] as never);
    const deadManifest = {
      id: "dead-1",
      pid: 9999,
      command: "claude",
      args: [],
      runId: "r1",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: "dead-1.log",
    };
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      if (String(path).includes("bad.json")) return "{ not valid json" as never;
      return JSON.stringify(deadManifest) as never;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, SPOOL_DIR);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "bad.json" }),
      "Failed to process manifest",
    );
    // the second, valid manifest is still processed
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1" }),
      "Orphaned agent process is dead, marking crashed",
    );

    killSpy.mockRestore();
  });

  it("rehydrates a live orphan: tracks it, emits process:started, and tails its log until it dies", async () => {
    vi.useFakeTimers();
    const ALIVE_PID = 2222;
    const manifest = {
      id: "alive-1",
      pid: ALIVE_PID,
      command: "claude",
      args: ["--print"],
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(SPOOL_DIR, "alive-1.log"),
    };
    const manifestPath = join(SPOOL_DIR, "alive-1.json");
    const logPath = join(SPOOL_DIR, "alive-1.log");

    vi.mocked(readdirSync).mockReturnValue(["alive-1.json"] as never);

    let aliveFlag = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === ALIVE_PID && aliveFlag) return true as never;
      throw new Error("ESRCH");
    });

    let watchCallback: (() => void) | undefined;
    const watcher = { close: vi.fn() };
    vi.mocked(watch).mockImplementation((_path, cb) => {
      watchCallback = cb as () => void;
      return watcher as never;
    });

    let logReadCount = 0;
    vi.mocked(readFileSync).mockImplementation((path: unknown, opts?: unknown) => {
      if (path === manifestPath) return JSON.stringify(manifest) as never;
      if (path === logPath) {
        if (opts === undefined) return Buffer.from("") as never; // tailLogForOrphan's initial size probe
        logReadCount += 1;
        if (logReadCount === 1) return "" as never; // rollingBuffer seed during rehydrate
        return "NEWDATA" as never; // simulated growth once the watcher fires
      }
      throw new Error(`unexpected read: ${String(path)}`);
    });

    const emitter = makeEmitter();
    const logger = makeLogger();
    const logStream = makeFakeWriteStream();
    vi.mocked(createWriteStream).mockReturnValue(logStream as never);
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: ALIVE_PID }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-9",
      "alive-1",
      "executor",
      "claude-code",
      "claude",
    );
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Simulate the log file growing: the watcher callback appends to the buffer.
    watchCallback?.();
    expect(runner.getProcessOutput("alive-1")).toBe("NEWDATA");
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith("run-9", "alive-1", "NEWDATA");

    // Now the orphan dies; the next poll tick should finalize it.
    aliveFlag = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(watcher.close).toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(logStream.end).toHaveBeenCalled();
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-9",
      "alive-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: ALIVE_PID }),
      "Orphaned process has exited",
    );

    // Once finalized, further watch events are ignored and close the watcher again.
    watchCallback?.();
    expect(watcher.close).toHaveBeenCalledTimes(2);

    killSpy.mockRestore();
  });

  it("tolerates missing/unreadable log and manifest files throughout the orphan lifecycle", async () => {
    vi.useFakeTimers();
    const ERR_PID = 3333;
    const manifest = {
      id: "err-1",
      pid: ERR_PID,
      command: "claude",
      args: [],
      runId: "run-err",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(SPOOL_DIR, "err-1.log"),
    };
    const manifestPath = join(SPOOL_DIR, "err-1.json");
    const logPath = join(SPOOL_DIR, "err-1.log");

    vi.mocked(readdirSync).mockReturnValue(["err-1.json"] as never);

    let aliveFlag = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === ERR_PID && aliveFlag) return true as never;
      throw new Error("ESRCH");
    });

    let watchCallback: (() => void) | undefined;
    const watcher = { close: vi.fn() };
    vi.mocked(watch).mockImplementation((_path, cb) => {
      watchCallback = cb as () => void;
      return watcher as never;
    });

    // The log file never exists (every read for it throws). The manifest file
    // is readable the first time (the initial directory scan) but fails on the
    // later re-read inside finalizeOrphan, exercising all of the module's
    // best-effort catch branches.
    let manifestReadCount = 0;
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      if (path === manifestPath) {
        manifestReadCount += 1;
        if (manifestReadCount === 1) return JSON.stringify(manifest) as never;
        throw new Error("manifest vanished");
      }
      if (path === logPath) {
        throw new Error("ENOENT: no log file");
      }
      throw new Error(`unexpected read: ${String(path)}`);
    });

    const emitter = makeEmitter();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, SPOOL_DIR);

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput("err-1")).toBe(""); // rollingBuffer seed failed silently

    // Watcher fires but the log read fails — handled by the ignore-and-continue catch.
    expect(() => watchCallback?.()).not.toThrow();
    expect(emitter.emitProcessOutput).not.toHaveBeenCalled();

    aliveFlag = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-err",
      "err-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    // The manifest rewrite inside finalizeOrphan was attempted but failed silently.
    expect(writeFileSync).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });
});
