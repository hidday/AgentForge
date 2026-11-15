import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentTimeoutError } from "../../src/utils/errors.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

const { ProcessRunner } = await import("../../src/runtime/processRunner.js");
type ProcessSpawnOptions = import("../../src/runtime/runnerTypes.js").ProcessSpawnOptions;

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockEmitter() {
  return {
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
  };
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
  killed = false;
  pid = 4242;
}

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "processRunner-test-"));
  spawnMock.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Log file writes go through an async WriteStream; give any in-flight
  // open/write/close finish before the spool dir is removed, otherwise the
  // stream's own fs callbacks fire after cleanup and surface as unhandled
  // ENOENT errors.
  await new Promise((r) => setTimeout(r, 50));
  try {
    rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "echo",
    args: ["hi"],
    cwd: "/tmp",
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("ProcessRunner.execute (real mode)", () => {
  it("resolves with accumulated stdout/stderr, exit code, and timedOut=false on success", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
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
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 0 }),
      "Process completed",
    );
  });

  it("resolves with a non-zero exit code when the process fails", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", 7);

    const result = await promise;
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exit code to 1 when close reports a null code", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("writes stdinData to the child and ends stdin when provided", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ stdinData: "payload" }));
    expect(child.stdin.write).toHaveBeenCalledWith("payload");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("ends stdin without writing when stdinData is omitted", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.emit("close", 0);
    await promise;
  });

  it("passes cwd and merged env through to spawn with piped stdio", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ cwd: "/work", env: { FOO: "bar" } }));
    expect(spawnMock).toHaveBeenCalledWith(
      "echo",
      ["hi"],
      expect.objectContaining({
        cwd: "/work",
        env: expect.objectContaining({ FOO: "bar" }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    child.emit("close", 0);
    await promise;
  });

  it("rejects with the spawn error when the child process errors (e.g. ENOENT)", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    child.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("kills the process with SIGTERM and rejects with AgentTimeoutError when it exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1_000 }),
      "Process timed out",
    );
  });

  it("escalates to SIGKILL if the process is still not killed 5s after SIGTERM", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    child.kill = vi.fn(); // never actually sets `killed`
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions({ timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(promise).rejects.toThrow(AgentTimeoutError);
  });

  it("tracks an active process, emits process:started, and writes a manifest when context is given", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute(
      baseOptions({ context: { runId: "run-1", stage: "executor", runtime: "claude-code" } }),
    );

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: child.pid,
      command: "echo",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      "echo",
    );
    expect(existsSync(join(spoolDir, `${active[0]!.id}.json`))).toBe(true);

    child.stdout.emit("data", Buffer.from("partial output"));
    expect(runner.getProcessOutput(active[0]!.id)).toBe("partial output");

    child.emit("close", 0);
    await promise;

    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
    const manifest = JSON.parse(
      readFileSync(join(spoolDir, `${active[0]!.id}.json`), "utf-8"),
    ) as { completedAt?: string; exitCode?: number };
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);
  });

  it("does not track an active process or write a manifest when context is omitted", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    const promise = runner.execute(baseOptions());
    expect(runner.getActiveProcesses()).toHaveLength(0);

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.execute (mock mode)", () => {
  it("delegates to the configured mock handler", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const result = await runner.execute(baseOptions());
    expect(result.stdout).toBe("mocked");
    expect(handler).toHaveBeenCalledWith(baseOptions());
  });

  it("throws when mock mode is used without a configured handler", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(runner.execute(baseOptions())).rejects.toThrow(
      "Mock mode enabled but no mock handler configured",
    );
  });
});

describe("ProcessRunner.getProcessOutput", () => {
  it("returns null when the process is unknown and no log file exists", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("nope")).toBeNull();
  });

  it("falls back to reading the spooled log file for a non-active process id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "orphan-1.log"), "logged output");
    expect(runner.getProcessOutput("orphan-1")).toBe("logged output");
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("does nothing when the spool directory has no manifest files", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({ id: "done", pid: 1, command: "x", completedAt: "2024-01-01T00:00:00Z" }),
    );
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest crashed when its pid is no longer alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    writeFileSync(
      join(spoolDir, "dead.json"),
      JSON.stringify({
        id: "dead",
        pid: 99999,
        command: "x",
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
        startedAt: "2024-01-01T00:00:00Z",
      }),
    );
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead" }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(join(spoolDir, "dead.json"), "utf-8")) as {
      crashed?: boolean;
      exitCode?: number;
    };
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
  });

  it("rehydrates a still-alive orphan into an active process and emits process:started", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    writeFileSync(
      join(spoolDir, "alive.json"),
      JSON.stringify({
        id: "alive",
        pid: 123,
        command: "claude",
        runId: "run-2",
        stage: "planner",
        runtime: "claude-code",
        startedAt: "2024-01-01T00:00:00Z",
      }),
    );
    writeFileSync(join(spoolDir, "alive.log"), "previous output");
    const emitter = makeMockEmitter();
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive", pid: 123 }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-2",
      "alive",
      "planner",
      "claude-code",
      "claude",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "alive", pid: 123, runId: "run-2" });
    expect(runner.getProcessOutput("alive")).toBe("previous output");
  });

  it("logs a warning and continues when a manifest file is corrupt JSON", () => {
    writeFileSync(join(spoolDir, "corrupt.json"), "{not json");
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "corrupt.json" }),
      "Failed to process manifest",
    );
  });
});
