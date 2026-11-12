import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const mockedSpawn = spawn as unknown as Mock;

// A pid that is astronomically unlikely to belong to any live process in this
// sandbox -- used to simulate a dead process without needing real subprocess
// bookkeeping (node:child_process is mocked for this file).
const DEAD_PID = 999_999;
const ROLLING_BUFFER_MAX = 8 * 1024;
const OUTPUT_THROTTLE_MS = 250;

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: Mock; end: Mock };
  pid: number;
  killed: boolean;
  kill: Mock;
};

function makeFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

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

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 5_000,
    ...overrides,
  };
}

let spoolBase: string;
let spoolDir: string;

beforeEach(() => {
  mockedSpawn.mockReset();
  spoolBase = mkdtempSync(join(tmpdir(), "processrunner-test-"));
  spoolDir = join(spoolBase, "spool");
});

afterEach(async () => {
  vi.useRealTimers();
  // Give any in-flight async WriteStream opens (createWriteStream uses an
  // async fs.open internally) a chance to settle before the directory they
  // target is removed, so a late open doesn't surface as an unhandled ENOENT.
  await new Promise((r) => setTimeout(r, 50));
  rmSync(spoolBase, { recursive: true, force: true });
});

describe("ProcessRunner constructor", () => {
  it("creates the spool directory (recursively) if it does not exist", () => {
    expect(existsSync(spoolDir)).toBe(false);
    new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    expect(existsSync(spoolDir)).toBe(true);
  });

  it("defaults the spool directory to .foundry/processes when none is given", () => {
    // Constructing with no spoolDir must not throw, and must resolve relative
    // to process.cwd() rather than crash for lack of a path.
    const cwdSpool = join(process.cwd(), ".foundry", "processes");
    expect(() => new ProcessRunner("mock", makeLogger() as never)).not.toThrow();
    expect(existsSync(cwdSpool)).toBe(true);
  });
});

describe("ProcessRunner.execute() in mock mode", () => {
  it("throws when no mock handler has been configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
    const result = {
      stdout: "mocked-out",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(result);
    runner.setMockHandler(handler);

    const options = baseOptions({ command: "fake-cli" });
    const actual = await runner.execute(options);

    expect(handler).toHaveBeenCalledWith(options);
    expect(actual).toEqual(result);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "fake-cli" }),
      "Executing mock process",
    );
    // spawn must never be touched in mock mode
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute() in real mode -- basic spawning", () => {
  it("spawns with merged env, pipes, and resolves stdout/stderr/exitCode on a clean exit", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(
      baseOptions({ command: "echo", args: ["hi"], cwd: "/tmp", env: { FOO: "bar" } }),
    );

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, spawnOpts] = mockedSpawn.mock.calls[0]!;
    expect(cmd).toBe("echo");
    expect(args).toEqual(["hi"]);
    expect(spawnOpts).toMatchObject({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
    expect(spawnOpts.env.FOO).toBe("bar");
    // process.env is still merged in underneath the extra env
    expect(spawnOpts.env.PATH).toBe(process.env.PATH);

    // no stdin data provided -> stdin.end() called, write() never called
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", Buffer.from("world"));
    child.stderr.emit("data", Buffer.from("warnings"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("warnings");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo", exitCode: 0 }),
      "Process completed",
    );
  });

  it("writes stdinData to the child and ends stdin when provided", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions({ stdinData: "payload-data" }));
    expect(child.stdin.write).toHaveBeenCalledWith("payload-data");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) on a non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions());
    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 3);

    const result = await promise;
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("boom");
  });

  it("defaults exitCode to 1 when the close event reports a null code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects with the underlying error when the child process errors out", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions());
    const err = new Error("spawn ENOENT");
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });
});

describe("ProcessRunner.execute() in real mode -- process tracking (context)", () => {
  function contextOptions() {
    return baseOptions({
      command: "my-cli",
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
  }

  it("registers an active process entry, writes a manifest, and emits process:started", async () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const child = makeFakeChild(5555);
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(contextOptions());

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    const { id } = active[0]!;
    expect(active[0]).toMatchObject({
      pid: 5555,
      command: "my-cli",
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    });

    const manifestPath = join(spoolDir, `${id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toMatchObject({ id, pid: 5555, command: "my-cli", runId: "run-1" });

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      "my-cli",
    );

    child.stdout.emit("data", Buffer.from("chunk1"));
    expect(runner.getProcessOutput(id)).toBe("chunk1");

    child.emit("close", 0);
    await promise;

    // cleaned up from the active map once closed
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.exitCode).toBe(0);
    expect(finalManifest.completedAt).toBeDefined();
    expect(typeof finalManifest.durationMs).toBe("number");

    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );

    // the log file on disk should eventually contain what was streamed
    await new Promise((r) => setTimeout(r, 100));
    const logPath = join(spoolDir, `${id}.log`);
    expect(readFileSync(logPath, "utf-8")).toContain("chunk1");
  });

  it("cleans up the active entry with exitCode -1 when the child errors out", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(contextOptions());
    const { id } = runner.getActiveProcesses()[0]!;

    const err = new Error("boom");
    child.emit("error", err);
    await expect(promise).rejects.toBe(err);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("still completes and emits process:completed when the manifest file is missing at cleanup time", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(contextOptions());
    const { id } = runner.getActiveProcesses()[0]!;
    // Remove the manifest out from under cleanupProcess's best-effort update.
    rmSync(join(spoolDir, `${id}.json`), { force: true });

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("does not register a process entry when context is omitted", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toHaveLength(0);
    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.execute() in real mode -- timeouts", () => {
  it("rejects with AgentTimeoutError and sends SIGTERM once the timeout elapses", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    // Simulate a process that successfully honors SIGTERM: kill() marks
    // `killed = true`, matching Node's documented semantics (killed reflects
    // that the signal was delivered, not that the process has actually exited).
    child.kill.mockImplementation(() => {
      child.killed = true;
      return true;
    });
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(
      baseOptions({ command: "sleep", args: ["100"], timeoutMs: 1_000 }),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Because `killed` is now true, the escalation timer must NOT send SIGKILL.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    await expect(promise).rejects.toMatchObject({
      agent: "sleep",
      timeoutMs: 1_000,
    });
  });

  it("escalates to SIGKILL after 5s when SIGTERM did not mark the child killed", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    // kill() never flips `killed` -- simulates a signal that was not delivered.
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("close", null);
    await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
  });

  it("uses runtime/stage as the timeout label when context is present", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(
      baseOptions({
        timeoutMs: 500,
        context: { runId: "r1", stage: "executor", runtime: "codex" },
      }),
    );

    await vi.advanceTimersByTimeAsync(500);
    child.emit("close", null);

    await expect(promise).rejects.toMatchObject({ agent: "codex/executor" });
  });

  it("never fires the timeout kill when the process closes before the deadline", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    child.emit("close", 0);
    const result = await promise;
    expect(result.timedOut).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("never fires the timeout kill when the process errors before the deadline", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const child = makeFakeChild();
    mockedSpawn.mockReturnValue(child);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    const err = new Error("early failure");
    child.emit("error", err);
    await expect(promise).rejects.toBe(err);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.getProcessOutput()", () => {
  it("returns null when the process is neither active nor logged to disk", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads and tail-truncates the on-disk log for a completed process", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const logPath = join(spoolDir, "done-id.log");
    const longContent = "y".repeat(ROLLING_BUFFER_MAX + 500) + "TAIL_MARKER";
    writeFileSync(logPath, longContent);

    const out = runner.getProcessOutput("done-id");
    expect(out).not.toBeNull();
    expect(out!.length).toBe(ROLLING_BUFFER_MAX);
    expect(out!.endsWith("TAIL_MARKER")).toBe(true);
  });

  it("returns null (rather than throwing) when the log path cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    // Create a directory where the log file would be, forcing an EISDIR on read.
    mkdirSync(join(spoolDir, "bad-id.log"));
    expect(runner.getProcessOutput("bad-id")).toBeNull();
  });
});

describe("ProcessRunner internals -- appendToBuffer (white-box)", () => {
  function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
      id: "p1",
      pid: 1,
      command: "x",
      context: { runId: "r1", stage: "s1", runtime: "t1" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
      ...overrides,
    };
  }

  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX characters", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const entry = makeEntry();
    const text = "a".repeat(ROLLING_BUFFER_MAX + 100) + "END";

    (runner as unknown as { appendToBuffer: (e: unknown, t: string) => void }).appendToBuffer(
      entry,
      text,
    );

    expect(entry.rollingBuffer.length).toBe(ROLLING_BUFFER_MAX);
    expect(entry.rollingBuffer.endsWith("END")).toBe(true);
  });

  it("does not throw when no emitter is configured", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const entry = makeEntry();
    expect(() =>
      (runner as unknown as { appendToBuffer: (e: unknown, t: string) => void }).appendToBuffer(
        entry,
        "hello",
      ),
    ).not.toThrow();
  });

  it("throttles emitted output to once per OUTPUT_THROTTLE_MS window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const entry = makeEntry();
    const append = (text: string) =>
      (runner as unknown as { appendToBuffer: (e: unknown, t: string) => void }).appendToBuffer(
        entry,
        text,
      );

    append("first");
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
    expect(emitter.emitProcessOutput).toHaveBeenCalledWith("r1", "p1", "first");

    vi.setSystemTime(1_000_000 + OUTPUT_THROTTLE_MS - 10);
    append("second");
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + OUTPUT_THROTTLE_MS + 10);
    append("third");
    expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);
  });

  it("truncates emitted chunks longer than 500 characters to their tail", () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const entry = makeEntry();
    const text = "z".repeat(600) + "TAIL";

    (runner as unknown as { appendToBuffer: (e: unknown, t: string) => void }).appendToBuffer(
      entry,
      text,
    );

    const [, , chunk] = emitter.emitProcessOutput.mock.calls[0]!;
    expect(chunk.length).toBe(500);
    expect(chunk.endsWith("TAIL")).toBe(true);
  });
});

describe("ProcessRunner.rehydrateOrphans()", () => {
  function manifestPathFor(id: string) {
    return join(spoolDir, `${id}.json`);
  }

  function writeManifest(id: string, overrides: Record<string, unknown> = {}) {
    mkdirSync(spoolDir, { recursive: true });
    const manifest = {
      id,
      pid: DEAD_PID,
      command: "cli",
      args: [],
      runId: "run-x",
      stage: "planner",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: join(spoolDir, `${id}.log`),
      ...overrides,
    };
    writeFileSync(manifestPathFor(id), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  it("returns silently when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have a completedAt", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeManifest("done-1", { completedAt: new Date().toISOString() });

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "Rehydrating orphaned agent process",
    );
  });

  it("logs a warning and skips a manifest file that fails to parse", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    mkdirSync(spoolDir, { recursive: true });
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeManifest("dead-1", { pid: DEAD_PID });

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: DEAD_PID }),
      "Orphaned agent process is dead, marking crashed",
    );
    expect(runner.getActiveProcesses()).toHaveLength(0);

    const manifest = JSON.parse(readFileSync(manifestPathFor("dead-1"), "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(manifest.completedAt).toBeDefined();
  });

  it("rehydrates a live process, restoring its rolling buffer from the existing log", () => {
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-1", { pid: process.pid });
    writeFileSync(manifest.logFile, "existing-log-content");

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-1", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive-1", runId: "run-x", stage: "planner" });
    expect(runner.getProcessOutput("alive-1")).toBe("existing-log-content");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-x",
      "alive-1",
      "planner",
      "claude-code",
      "cli",
    );
  });

  it("logs a parse failure when an orphan's log file does not yet exist on disk", () => {
    // createWriteStream()'s fs.open() is asynchronous, while fs.watch() is
    // called synchronously right after it inside tailLogForOrphan. When no
    // log file pre-exists, fs.watch loses that race and throws ENOENT, which
    // bubbles up through the per-manifest try/catch as a parse failure --
    // a real boundary condition of the rehydrate path, not a contrived one.
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeManifest("alive-2", { pid: process.pid, logFile: join(spoolDir, "alive-2.log") });
    // Deliberately do not create the log file.

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "alive-2.json" }),
      "Failed to process manifest",
    );
  });

  it("tails new writes to the orphan's log file into the rolling buffer", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-3", { pid: process.pid });
    writeFileSync(manifest.logFile, "start");

    runner.rehydrateOrphans();

    // Append more data to the log file in real time; fs.watch should pick it up.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(manifest.logFile, "-more");

    await new Promise((r) => setTimeout(r, 300));

    expect(runner.getProcessOutput("alive-3")).toBe("start-more");
    expect(emitter.emitProcessOutput).toHaveBeenCalled();
  });

  it("closes the watcher without crashing when its entry has already been removed", async () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-4", { pid: process.pid });
    writeFileSync(manifest.logFile, "start");

    runner.rehydrateOrphans();

    // Simulate the entry having been cleaned up through some other path.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "alive-4",
    );

    const { appendFileSync } = await import("node:fs");
    appendFileSync(manifest.logFile, "-more");
    await new Promise((r) => setTimeout(r, 300));

    expect(emitter.emitProcessOutput).not.toHaveBeenCalled();
  });

  it("finalizes an orphan as crashed once its pid is detected as dead by the poll interval", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-5", { pid: process.pid });
    // Pre-create the log file so fs.watch (set up synchronously inside
    // rehydrateOrphans) doesn't race the async open() of the write stream.
    writeFileSync(manifest.logFile, "start");

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // White-box: flip the tracked pid to a dead one so the next poll tick
    // observes the process as gone, without needing a real process to die.
    (
      runner as unknown as { activeProcesses: Map<string, { pid: number }> }
    ).activeProcesses.get("alive-5")!.pid = DEAD_PID;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-x",
      "alive-5",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-5" }),
      "Orphaned process has exited",
    );

    const finalManifest = JSON.parse(readFileSync(manifestPathFor("alive-5"), "utf-8"));
    expect(finalManifest.exitCode).toBe(-1);
    expect(finalManifest.completedAt).toBeDefined();
  });

  it("still finalizes and emits process:completed when the orphan's manifest file is missing", async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-6", { pid: process.pid });
    writeFileSync(manifest.logFile, "start");

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    (
      runner as unknown as { activeProcesses: Map<string, { pid: number }> }
    ).activeProcesses.get("alive-6")!.pid = DEAD_PID;
    // Remove the manifest out from under finalizeOrphan's best-effort update.
    rmSync(manifestPathFor("alive-6"), { force: true });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-x",
      "alive-6",
      "planner",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-6" }),
      "Orphaned process has exited",
    );
  });

  it("finalizeOrphan is a no-op when the processId is not tracked", () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    (runner as unknown as { finalizeOrphan: (id: string) => void }).finalizeOrphan("nope");

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("falls back to signaling the process group (pid 0) when the entry is gone before a poll tick, so it is never finalized", async () => {
    vi.useFakeTimers();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);
    const manifest = writeManifest("alive-7", { pid: process.pid });
    writeFileSync(manifest.logFile, "start");

    runner.rehydrateOrphans();
    // Remove the entry directly so `activeProcesses.get(id)?.pid` resolves to
    // the `?? 0` fallback on the next poll tick. process.kill(0, 0) signals
    // this process's whole group and succeeds rather than throwing, so the
    // poll loop does not treat this as a dead process.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "alive-7",
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner internals -- cleanupProcess (white-box)", () => {
  it("is a no-op when the processId is not tracked", () => {
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    (
      runner as unknown as {
        cleanupProcess: (id: string, exitCode: number, durationMs: number) => void;
      }
    ).cleanupProcess("bogus-id", 0, 10);

    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });
});
