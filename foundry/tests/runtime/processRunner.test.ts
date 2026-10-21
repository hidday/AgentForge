import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.killed = false;
  return child;
}

function collectDashboardEvents(emitter: RunEventEmitter): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  emitter.on("dashboard", (e: DashboardEvent) => events.push(e));
  return events;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner construction", () => {
  it("creates the spool directory on construction", () => {
    const nested = join(spoolDir, "nested", "dir");
    new ProcessRunner("mock", makeMockLogger() as never, undefined, nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("ProcessRunner mock mode", () => {
  it("throws when no mock handler is configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const result = { stdout: "mocked", stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
    const handler = vi.fn().mockResolvedValue(result);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = { command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 };
    await expect(runner.execute(options)).resolves.toEqual(result);
    expect(handler).toHaveBeenCalledWith(options);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner real mode: happy path", () => {
  it("resolves with concatenated stdout/stderr and exit code on close, with no manifest when no context is given", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { FOO: "bar" },
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({ FOO: "bar" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    expect(child.stdin.end).toHaveBeenCalled();
    expect(child.stdin.write).not.toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warn: x"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn: x",
      exitCode: 0,
      durationMs: expect.any(Number),
      timedOut: false,
    });

    // No context => no manifest/log files written to the spool dir.
    expect(readdirSync(spoolDir)).toHaveLength(0);
  });

  it("writes stdin data when provided, instead of just ending the stream", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "cat",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "piped in",
    });

    expect(child.stdin.write).toHaveBeenCalledWith("piped in");
    expect(child.stdin.end).toHaveBeenCalled();

    child.emit("close", 0);
    await promise;
  });

  it("persists a manifest and log file when a context is given, and updates them on completion", async () => {
    const child = makeFakeChild(9999);
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const emitter = new RunEventEmitter();
    const events = collectDashboardEvents(emitter);
    const runner = new ProcessRunner("real", logger as never, emitter, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    const manifestFiles = readdirSync(spoolDir).filter((f) => f.endsWith(".json"));
    expect(manifestFiles).toHaveLength(1);
    const processId = manifestFiles[0]!.replace(/\.json$/, "");

    const manifestBefore = JSON.parse(readFileSync(join(spoolDir, manifestFiles[0]!), "utf-8"));
    expect(manifestBefore).toMatchObject({
      id: processId,
      pid: 9999,
      command: "claude",
      args: ["--print"],
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(manifestBefore.completedAt).toBeUndefined();

    const started = events.find((e) => e.type === "process:started");
    expect(started).toMatchObject({
      type: "process:started",
      runId: "run-1",
      processId,
      stage: "executor",
      runtime: "claude-code",
      command: "claude",
    });

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(processId)).toBe("partial output");

    child.emit("close", 0);
    await promise;

    const manifestAfter = JSON.parse(readFileSync(join(spoolDir, `${processId}.json`), "utf-8"));
    expect(manifestAfter.completedAt).toBeDefined();
    expect(manifestAfter.exitCode).toBe(0);
    expect(typeof manifestAfter.durationMs).toBe("number");

    const completed = events.find((e) => e.type === "process:completed");
    expect(completed).toMatchObject({
      type: "process:completed",
      runId: "run-1",
      processId,
      exitCode: 0,
    });

    const logContent = readFileSync(join(spoolDir, `${processId}.log`), "utf-8");
    expect(logContent).toBe("partial output");

    // Process finished, so it's no longer "active".
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("truncates the in-memory rolling buffer to the last 8KB of output", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "noisy",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });

    const processId = readdirSync(spoolDir).find((f) => f.endsWith(".json"))!.replace(/\.json$/, "");

    const big = "a".repeat(8000) + "TAIL_MARKER_END";
    child.stdout.emit("data", Buffer.from(big));

    const buffered = runner.getProcessOutput(processId)!;
    expect(buffered.length).toBe(8 * 1024);
    expect(buffered.endsWith("TAIL_MARKER_END")).toBe(true);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner real mode: getActiveProcesses", () => {
  it("lists currently running processes with their context and elapsed time", async () => {
    const child = makeFakeChild(555);
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "slow-cmd",
      args: ["--x"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "planner", runtime: "codex" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 555,
      command: "slow-cmd",
      runId: "run-3",
      stage: "planner",
      runtime: "codex",
    });
    expect(active[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    child.emit("close", 0);
    await promise;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe("ProcessRunner real mode: getProcessOutput", () => {
  it("returns null when the process is neither active nor has a log file on disk", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nonexistent-id")).toBeNull();
  });

  it("falls back to reading the tail of the on-disk log file once the process is no longer active", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "cmd",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-4", stage: "executor", runtime: "claude-code" },
    });
    const processId = readdirSync(spoolDir).find((f) => f.endsWith(".json"))!.replace(/\.json$/, "");

    child.stdout.emit("data", Buffer.from("from disk after completion"));
    child.emit("close", 0);
    await promise;

    expect(runner.getProcessOutput(processId)).toBe("from disk after completion");
  });

  it("returns null when the log file exists but can't be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    // existsSync passes but readFileSync would fail on a directory path.
    const dirAsLogPath = join(spoolDir, "broken-id.log");
    writeFileSync(dirAsLogPath, "ok");
    rmSync(dirAsLogPath);
    expect(runner.getProcessOutput("broken-id")).toBeNull();
  });
});

describe("ProcessRunner real mode: error handling", () => {
  it("rejects when the child process emits an error, and marks the manifest crashed with exit code -1", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = new RunEventEmitter();
    const events = collectDashboardEvents(emitter);
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter, spoolDir);

    const promise = runner.execute({
      command: "missing-binary",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-5", stage: "executor", runtime: "claude-code" },
    });
    const processId = readdirSync(spoolDir).find((f) => f.endsWith(".json"))!.replace(/\.json$/, "");

    const spawnError = new Error("spawn ENOENT");
    child.emit("error", spawnError);

    await expect(promise).rejects.toThrow("spawn ENOENT");

    const manifest = JSON.parse(readFileSync(join(spoolDir, `${processId}.json`), "utf-8"));
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();

    const completed = events.find((e) => e.type === "process:completed");
    expect(completed).toMatchObject({ processId, exitCode: -1 });
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rejects on error without touching the spool dir when no context was given", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 5000 });
    child.emit("error", new Error("boom"));

    await expect(promise).rejects.toThrow("boom");
    expect(readdirSync(spoolDir)).toHaveLength(0);
  });
});

describe("ProcessRunner real mode: timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends SIGTERM on timeout, escalates to SIGKILL if still alive, and rejects with AgentTimeoutError", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "hangs",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: { runId: "run-6", stage: "executor", runtime: "claude-code" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    // child.killed stays false (fake process never actually dies) -> SIGKILL fallback fires.
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    child.emit("close", null);

    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ command: "hangs", timeoutMs: 1000 }),
      "Process timed out",
    );
  });

  it("does not escalate to SIGKILL if the child reports killed:true before the grace period elapses", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "hangs", args: [], cwd: "/tmp", timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    child.killed = true;

    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("clears the timeout and resolves normally when the process closes before the deadline", async () => {
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute({ command: "fast", args: [], cwd: "/tmp", timeoutMs: 10_000 });
    child.emit("close", 0);
    const result = await promise;
    expect(result.timedOut).toBe(false);

    // Advancing well past the timeout must not fire SIGTERM; the timer was cleared.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner output throttling", () => {
  it("throttles process:output dashboard emissions to once per 250ms window", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const emitter = new RunEventEmitter();
    const events = collectDashboardEvents(emitter);
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter, spoolDir);

    const promise = runner.execute({
      command: "stream",
      args: [],
      cwd: "/tmp",
      timeoutMs: 999_999,
      context: { runId: "run-7", stage: "executor", runtime: "claude-code" },
    });

    child.stdout.emit("data", Buffer.from("chunk-1"));
    child.stdout.emit("data", Buffer.from("chunk-2")); // same tick, should be throttled away

    await vi.advanceTimersByTimeAsync(300);
    child.stdout.emit("data", Buffer.from("chunk-3")); // outside the throttle window, should emit

    const outputEvents = events.filter((e) => e.type === "process:output");
    expect(outputEvents).toHaveLength(2);
    expect(outputEvents[0]).toMatchObject({ chunk: "chunk-1" });
    expect(outputEvents[1]).toMatchObject({ chunk: "chunk-3" });

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns silently when the spool directory can't be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("ignores non-.json files and manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "notes.txt"), "irrelevant");
    writeFileSync(
      join(spoolDir, "done-1.json"),
      JSON.stringify({ id: "done-1", pid: 1, command: "x", args: [], runId: "r", stage: "s", runtime: "codex", startedAt: new Date().toISOString(), logFile: "x", completedAt: new Date().toISOString() }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a warning and skips a manifest file it can't parse", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "corrupt.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a dead orphan's manifest as crashed", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifest = {
      id: "orphan-dead",
      pid: 999_999,
      command: "claude",
      args: ["--print"],
      runId: "run-8",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "orphan-dead.log"),
    };
    writeFileSync(join(spoolDir, "orphan-dead.json"), JSON.stringify(manifest));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-dead", pid: 999_999 }),
      "Orphaned agent process is dead, marking crashed",
    );
    const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-dead.json"), "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("rehydrates an alive orphan into the active process map and emits process:started", () => {
    const logger = makeMockLogger();
    const emitter = new RunEventEmitter();
    const events = collectDashboardEvents(emitter);
    const runner = new ProcessRunner("real", logger as never, emitter, spoolDir);

    // Avoid setting up a real fs.watch()/setInterval() for this orphan — that
    // machinery is covered indirectly isn't needed for this assertion, which is
    // about the rehydration bookkeeping itself.
    vi.spyOn(ProcessRunner.prototype as never, "tailLogForOrphan").mockImplementation(() => {});

    const manifest = {
      id: "orphan-alive",
      pid: process.pid,
      command: "claude",
      args: ["--print"],
      runId: "run-9",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "orphan-alive.log"),
    };
    writeFileSync(join(spoolDir, "orphan-alive.json"), JSON.stringify(manifest));
    writeFileSync(join(spoolDir, "orphan-alive.log"), "previously logged output");

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-alive", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "orphan-alive", runId: "run-9", stage: "executor" });
    expect(runner.getProcessOutput("orphan-alive")).toBe("previously logged output");

    const started = events.find((e) => e.type === "process:started");
    expect(started).toMatchObject({ processId: "orphan-alive", runId: "run-9", command: "claude" });

    // Clean up the real write stream opened for this rehydrated entry.
    (runner as never as { activeProcesses: Map<string, { logStream?: { end(): void } }> })
      .activeProcesses.get("orphan-alive")
      ?.logStream?.end();
  });

  it("finalizeOrphan marks an active entry completed, updates its manifest, and emits process:completed", () => {
    const logger = makeMockLogger();
    const emitter = new RunEventEmitter();
    const events = collectDashboardEvents(emitter);
    const runner = new ProcessRunner("real", logger as never, emitter, spoolDir);
    vi.spyOn(ProcessRunner.prototype as never, "tailLogForOrphan").mockImplementation(() => {});

    const manifest = {
      id: "orphan-finalize",
      pid: process.pid,
      command: "claude",
      args: [],
      runId: "run-10",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, "orphan-finalize.log"),
    };
    writeFileSync(join(spoolDir, "orphan-finalize.json"), JSON.stringify(manifest));
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    (runner as unknown as { finalizeOrphan(id: string): void }).finalizeOrphan("orphan-finalize");

    expect(runner.getActiveProcesses()).toHaveLength(0);
    const updated = JSON.parse(readFileSync(join(spoolDir, "orphan-finalize.json"), "utf-8"));
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    const completed = events.find((e) => e.type === "process:completed");
    expect(completed).toMatchObject({ processId: "orphan-finalize", runId: "run-10", exitCode: -1 });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-finalize" }),
      "Orphaned process has exited",
    );
  });

  it("finalizeOrphan is a no-op when the process id is not active", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(() =>
      (runner as unknown as { finalizeOrphan(id: string): void }).finalizeOrphan("never-existed"),
    ).not.toThrow();
  });
});
