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

beforeEach(() => {
  mkdirSyncMock.mockReset();
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
  readdirSyncMock.mockReset();
  writeFileSyncMock.mockReset();
  createWriteStreamMock.mockReset();
  watchMock.mockReset();
  spawnMock.mockReset();
  createWriteStreamMock.mockReturnValue(makeFakeWriteStream());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProcessRunner — real-mode branches not covered elsewhere", () => {
  it("hits the context-truthy side of the timeout label ternary (runtime/stage, not the bare command)", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess(501);
      spawnMock.mockReturnValue(child);
      const logger = makeLogger();
      readFileSyncMock.mockImplementation(() => {
        throw new Error("no manifest");
      });
      const runner = new ProcessRunner("real", logger as never);
      const context: ProcessContext = { runId: "run-9", stage: "executor", runtime: "codex" };

      const promise = runner.execute({ ...baseOptions, timeoutMs: 1000, context });
      const assertion = expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("codex/executor"),
      });

      await vi.advanceTimersByTimeAsync(1000);
      child.emit("close", null);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses `code ?? 1` default when a tracked (context) process closes with a null code", async () => {
    const child = new FakeChildProcess(502);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    readFileSyncMock.mockImplementation(() => {
      throw new Error("no manifest");
    });
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const context: ProcessContext = { runId: "run-10", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
    child.emit("close", null);
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-10",
      expect.any(String),
      "executor",
      "claude-code",
      1,
      expect.any(Number),
    );
  });

  it("skips tracking (no manifest/emitter events) when the spawned child has no pid, but still cleans up safely on close", async () => {
    const child = new FakeChildProcess(0);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const context: ProcessContext = { runId: "run-11", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
    // No active process should have been registered since child.pid was falsy.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();

    child.emit("close", 0);
    await promise;

    // cleanupProcess(processId, ...) ran against a processId with no matching
    // entry in the map; it must no-op rather than throw or emit.
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("truncates the rolling buffer to the last ROLLING_BUFFER_MAX bytes once it overflows", async () => {
    const child = new FakeChildProcess(503);
    spawnMock.mockReturnValue(child);
    const runner = new ProcessRunner("real", makeLogger() as never);
    const context: ProcessContext = { runId: "run-12", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
    const activeId = runner.getActiveProcesses()[0]!.id;

    const big = "x".repeat(9000); // > 8 * 1024
    child.stdout.emit("data", Buffer.from(big));

    const buffered = runner.getProcessOutput(activeId)!;
    expect(buffered.length).toBe(8 * 1024);
    expect(buffered).toBe(big.slice(-8 * 1024));

    child.emit("close", 0);
    await promise;
  });

  it("emits only the last 500 chars of output when a chunk exceeds the emit-chunk limit", async () => {
    const child = new FakeChildProcess(504);
    spawnMock.mockReturnValue(child);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
    const context: ProcessContext = { runId: "run-13", stage: "executor", runtime: "claude-code" };

    const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000, context });
    const longChunk = "y".repeat(600);
    child.stdout.emit("data", Buffer.from(longChunk));

    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-13",
      expect.any(String),
      longChunk.slice(-500),
    );

    child.emit("close", 0);
    await promise;
  });
});

describe("ProcessRunner.rehydrateOrphans — orphan tailing and lifecycle (fs.watch / setInterval driven)", () => {
  const manifest = {
    id: "orphan-tail-1",
    pid: 7777,
    command: "claude",
    args: [],
    runId: "run-orphan",
    stage: "executor",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    logFile: "/spool/orphan-tail-1.log",
  };

  it("hits the catch branch when the existing log cannot be read during rehydrate and during the initial tail-size read", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    // The manifest read succeeds; any other readFileSync call (the rolling
    // buffer seed and tailLogForOrphan's own lastSize probe) throws, exercising
    // both "no log file yet" catch blocks.
    readFileSyncMock.mockImplementation((p: string) => {
      if (String(p).endsWith("orphan.json")) return JSON.stringify(manifest);
      throw new Error("ENOENT: no log file yet");
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    watchMock.mockReturnValue({ close: vi.fn() });

    const runner = new ProcessRunner("real", makeLogger() as never);
    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(runner.getProcessOutput("orphan-tail-1")).toBe("");
    // tailLogForOrphan derives its log path from the spool dir + process id
    // (NOT the manifest's `logFile` field), so just assert on the filename.
    expect(watchMock).toHaveBeenCalledWith(
      expect.stringContaining("orphan-tail-1.log"),
      expect.any(Function),
    );
  });

  it("appends new log content to the rolling buffer when the watcher fires with growth", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    let logContent = "initial content";
    readFileSyncMock.mockImplementation((p: string, enc?: string) => {
      if (String(p).endsWith("orphan.json")) return JSON.stringify(manifest);
      if (enc === "utf-8") return logContent;
      return Buffer.from(logContent);
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });

    const runner = new ProcessRunner("real", makeLogger() as never);
    runner.rehydrateOrphans();

    expect(runner.getProcessOutput("orphan-tail-1")).toBe("initial content");

    logContent = "initial contentMORE";
    watchCallback?.();

    expect(runner.getProcessOutput("orphan-tail-1")).toBe("initial contentMORE");
  });

  it("ignores a watcher read error without throwing", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    let shouldThrow = false;
    readFileSyncMock.mockImplementation((p: string, enc?: string) => {
      if (String(p).endsWith("orphan.json")) return JSON.stringify(manifest);
      if (shouldThrow) throw new Error("transient read error");
      if (enc === "utf-8") return "some content";
      return Buffer.from("some content");
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let watchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: vi.fn() };
    });

    const runner = new ProcessRunner("real", makeLogger() as never);
    runner.rehydrateOrphans();

    shouldThrow = true;
    expect(() => watchCallback?.()).not.toThrow();
  });

  it("closes the watcher and no-ops when it fires after the process entry is already gone", () => {
    readdirSyncMock.mockReturnValue(["orphan.json"]);
    readFileSyncMock.mockImplementation((p: string, enc?: string) => {
      if (String(p).endsWith("orphan.json")) return JSON.stringify(manifest);
      if (enc === "utf-8") return "content";
      return Buffer.from("content");
    });
    vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let watchCallback: (() => void) | undefined;
    const watcherClose = vi.fn();
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });

    const runner = new ProcessRunner("real", makeLogger() as never);
    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // getProcessOutput falling back to the on-disk log also requires an
    // existsSync check when the entry is gone; stub it so the assertion below
    // reads from the (now stale) in-memory path is irrelevant here -- we only
    // care that invoking the watcher callback after removal is a safe no-op.
    (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
      "orphan-tail-1",
    );

    expect(() => watchCallback?.()).not.toThrow();
    expect(watcherClose).toHaveBeenCalled();
  });

  it("poll interval: keeps the process active while process.kill(pid, 0) keeps succeeding", () => {
    vi.useFakeTimers();
    try {
      readdirSyncMock.mockReturnValue(["orphan.json"]);
      readFileSyncMock.mockImplementation((p: string, enc?: string) => {
        if (String(p).endsWith("orphan.json")) return JSON.stringify(manifest);
        if (enc === "utf-8") return "content";
        return Buffer.from("content");
      });
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
      watchMock.mockReturnValue({ close: vi.fn() });

      const runner = new ProcessRunner("real", makeLogger() as never);
      runner.rehydrateOrphans();

      vi.advanceTimersByTime(5_000);

      expect(killSpy).toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("poll interval: finalizes the orphan (removes tracking, rewrites manifest, emits completed) once process.kill throws (process died)", () => {
    vi.useFakeTimers();
    try {
      readdirSyncMock.mockReturnValue(["orphan.json"]);
      let manifestReadCount = 0;
      readFileSyncMock.mockImplementation((p: string, enc?: string) => {
        // Both the initial rehydrate read (disk filename "orphan.json") and
        // finalizeOrphan's own re-read (processId-based "orphan-tail-1.json")
        // need to resolve to the manifest.
        if (String(p).endsWith(".json")) {
          manifestReadCount++;
          return JSON.stringify(manifest);
        }
        if (enc === "utf-8") return "content";
        return Buffer.from("content");
      });
      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementationOnce(() => true as never) // initial rehydrate liveness check
        .mockImplementation(() => {
          throw new Error("ESRCH");
        });
      const watcherClose = vi.fn();
      watchMock.mockReturnValue({ close: watcherClose });
      const emitter = makeEmitter();
      const logger = makeLogger();

      const runner = new ProcessRunner("real", logger as never, emitter as never);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      vi.advanceTimersByTime(5_000);

      expect(killSpy).toHaveBeenCalled();
      expect(watcherClose).toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-orphan",
        "orphan-tail-1",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-tail-1", pid: 7777 }),
        "Orphaned process has exited",
      );
      // manifest was read at least twice: once in rehydrate, once in finalizeOrphan
      expect(manifestReadCount).toBeGreaterThanOrEqual(2);
      const manifestWrite = writeFileSyncMock.mock.calls.find(
        ([path]) => String(path).endsWith("orphan-tail-1.json"),
      );
      expect(manifestWrite).toBeDefined();
      const written = JSON.parse(manifestWrite![1] as string);
      expect(written.exitCode).toBe(-1);
      expect(written.completedAt).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalizeOrphan tolerates a manifest it cannot re-read (best-effort update)", () => {
    vi.useFakeTimers();
    try {
      readdirSyncMock.mockReturnValue(["orphan.json"]);
      let manifestReadCount = 0;
      readFileSyncMock.mockImplementation((p: string, enc?: string) => {
        if (String(p).endsWith(".json")) {
          manifestReadCount++;
          if (manifestReadCount === 1) return JSON.stringify(manifest);
          throw new Error("manifest vanished");
        }
        if (enc === "utf-8") return "content";
        return Buffer.from("content");
      });
      vi.spyOn(process, "kill")
        .mockImplementationOnce(() => true as never)
        .mockImplementation(() => {
          throw new Error("ESRCH");
        });
      watchMock.mockReturnValue({ close: vi.fn() });
      const emitter = makeEmitter();

      const runner = new ProcessRunner("real", makeLogger() as never, emitter as never);
      runner.rehydrateOrphans();

      expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();

      expect(emitter.emitProcessCompleted).toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stringifies a non-Error thrown while processing a manifest in rehydrateOrphans", () => {
    readdirSyncMock.mockReturnValue(["weird.json"]);
    readFileSyncMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "disk fell over";
    });
    const logger = makeLogger();

    const runner = new ProcessRunner("real", logger as never);
    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      { file: "weird.json", error: "disk fell over" },
      "Failed to process manifest",
    );
  });

  it("poll interval: defaults to pid 0 via `?? 0` when the tracked entry has already been removed, then finalizeOrphan no-ops since the entry is gone", () => {
    vi.useFakeTimers();
    try {
      readdirSyncMock.mockReturnValue(["orphan.json"]);
      readFileSyncMock.mockImplementation((p: string, enc?: string) => {
        if (String(p).endsWith(".json")) return JSON.stringify(manifest);
        if (enc === "utf-8") return "content";
        return Buffer.from("content");
      });
      const killCalls: unknown[] = [];
      vi.spyOn(process, "kill").mockImplementation((pid: unknown) => {
        killCalls.push(pid);
        // First call is the initial rehydrate liveness check -- must succeed
        // so the orphan is tracked and the poll interval is scheduled.
        if (killCalls.length === 1) return true as never;
        throw new Error("ESRCH");
      });
      const watcherClose = vi.fn();
      watchMock.mockReturnValue({ close: watcherClose });
      const emitter = makeEmitter();
      const logger = makeLogger();

      const runner = new ProcessRunner("real", logger as never, emitter as never);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Simulate the tracked entry having already been removed by some other
      // path (e.g. a concurrent cleanup) before the poll interval's next tick.
      (runner as unknown as { activeProcesses: Map<string, unknown> }).activeProcesses.delete(
        "orphan-tail-1",
      );

      vi.advanceTimersByTime(5_000);

      // `this.activeProcesses.get(processId)?.pid ?? 0` -- entry is gone, so
      // process.kill was called with the `?? 0` fallback pid.
      expect(killCalls[1]).toBe(0);
      expect(watcherClose).toHaveBeenCalled();
      // finalizeOrphan's own `if (!entry) return;` short-circuits: no
      // completion event and no "exited" log, since the entry was already gone.
      expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-tail-1" }),
        "Orphaned process has exited",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
