import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import * as fsNS from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Logger } from "../../src/utils/logger.js";
import type { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// This file targets the small remaining coverage gaps in processRunner.ts that
// the main processRunner.test.ts suite does not exercise: the fs.watch-driven
// log tailing callback for rehydrated orphans, the various best-effort catch
// blocks around manifest/log I/O, and a couple of branches that require a
// specific combination of "tracked process" + "null exit code"/"timeout".
//
// node:fs is mocked only so individual functions (readFileSync, watch) can be
// made to throw or have their callback captured deterministically in specific
// tests; every test restores the real implementation afterwards, and all
// other tests use the real filesystem via a temp directory exactly like
// processRunner.test.ts does.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

const mockSpawn = vi.mocked(spawn);

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

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid = 1234): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function writeManifest(
  tmpDir: string,
  id: string,
  overrides: Partial<{ pid: number; runId: string; stage: string; runtime: string }> = {},
) {
  writeFileSync(
    join(tmpDir, `${id}.json`),
    JSON.stringify({
      id,
      pid: overrides.pid ?? 1,
      command: "claude",
      args: [],
      runId: overrides.runId ?? "run-x",
      stage: overrides.stage ?? "executor",
      runtime: overrides.runtime ?? "claude",
      startedAt: new Date().toISOString(),
      logFile: join(tmpDir, `${id}.log`),
    }),
  );
}

describe("ProcessRunner — coverage gaps", () => {
  let tmpDir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "process-runner-gap-"));
    logger = makeLogger();
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor default spoolDir", () => {
    it("falls back to .foundry/processes under the cwd when no spoolDir is given", () => {
      const defaultSpoolDir = join(process.cwd(), ".foundry", "processes");
      const preexisted = existsSync(defaultSpoolDir);

      expect(() => new ProcessRunner("real", logger as unknown as Logger)).not.toThrow();
      expect(existsSync(defaultSpoolDir)).toBe(true);

      if (!preexisted) {
        rmSync(join(process.cwd(), ".foundry"), { recursive: true, force: true });
      }
    });
  });

  describe("getProcessOutput: on-disk read failure", () => {
    it("returns null when the log file exists but readFileSync throws", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const logPath = join(tmpDir, "unreadable.log");
      writeFileSync(logPath, "some content");

      const spy = vi.spyOn(fsNS, "readFileSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      expect(runner.getProcessOutput("unreadable")).toBeNull();

      spy.mockRestore();
    });
  });

  describe("rehydrateOrphans: readdirSync failure after construction", () => {
    it("returns early (and does not throw) when the spool directory is removed after the runner is constructed", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      // The constructor already created tmpDir; remove it now so readdirSync
      // inside rehydrateOrphans itself throws (unlike removing it *before*
      // construction, which the constructor's mkdirSync would just recreate).
      rmSync(tmpDir, { recursive: true, force: true });

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });
  });

  describe("rehydrateOrphans: missing log file for a live orphan", () => {
    it("swallows the read errors for both the initial rollingBuffer hydration and the tailer's lastSize read when no log file exists yet", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      writeManifest(tmpDir, "no-log-1", { pid: 55555, runId: "run-no-log" });
      // Deliberately do NOT create no-log-1.log — createWriteStream({flags:"a"})
      // opens its fd asynchronously, so the log file does not exist yet at the
      // point rehydrateOrphans synchronously tries to read it.

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      expect(() => runner.rehydrateOrphans()).not.toThrow();

      expect(runner.getActiveProcesses()).toHaveLength(1);
      // rollingBuffer hydration (line ~162) failed silently -> empty buffer.
      expect(runner.getProcessOutput("no-log-1")).toBe("");

      killSpy.mockRestore();
    });
  });

  describe("rehydrateOrphans: non-Error thrown while processing a manifest", () => {
    it("stringifies a non-Error throw via String(err) in the warning log", () => {
      const emitter = makeEmitter();
      // Make emitProcessStarted throw a plain string instead of an Error to
      // exercise the `err instanceof Error ? err.message : String(err)` false
      // branch.
      emitter.emitProcessStarted.mockImplementation(() => {
        throw "not-an-error-instance";
      });

      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );
      writeManifest(tmpDir, "throws-1", { pid: 66666 });
      writeFileSync(join(tmpDir, "throws-1.log"), "x");

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        { file: "throws-1.json", error: "not-an-error-instance" },
        "Failed to process manifest",
      );
      // The entry was added to the active-process map before the throwing
      // emitProcessStarted call, so it is still tracked even though the
      // manifest-processing loop iteration failed.
      expect(runner.getActiveProcesses()).toHaveLength(1);

      killSpy.mockRestore();
    });
  });

  describe("tailLogForOrphan watcher callback: entry present", () => {
    it("appends only the new chunk on growth, ignores no-op fires, and swallows a read error without touching the buffer", () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );

      const logPath = join(tmpDir, "watched-1.log");
      writeFileSync(logPath, "initial\n");
      writeManifest(tmpDir, "watched-1", { pid: 77777, runId: "run-watched" });

      let capturedCb: (() => void) | undefined;
      const watcherClose = vi.fn();
      const watchSpy = vi.spyOn(fsNS, "watch").mockImplementation((_path, cb) => {
        capturedCb = cb as () => void;
        return { close: watcherClose } as unknown as ReturnType<typeof fsNS.watch>;
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      runner.rehydrateOrphans();
      expect(capturedCb).toBeTypeOf("function");

      // 1. Growth: content gets longer -> appendToBuffer called with the delta.
      writeFileSync(logPath, "initial\nmore-data");
      capturedCb!();
      expect(runner.getProcessOutput("watched-1")).toBe("initial\nmore-data");
      expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
        "run-watched",
        "watched-1",
        "more-data",
      );
      const callsAfterGrowth = emitter.emitProcessOutput.mock.calls.length;

      // 2. No-op fire: content unchanged -> no further append/emit.
      capturedCb!();
      expect(runner.getProcessOutput("watched-1")).toBe("initial\nmore-data");
      expect(emitter.emitProcessOutput.mock.calls.length).toBe(callsAfterGrowth);

      // 3. Read error on fire (file removed): caught silently, buffer untouched.
      rmSync(logPath, { force: true });
      expect(() => capturedCb!()).not.toThrow();
      expect(runner.getProcessOutput("watched-1")).toBe("initial\nmore-data");
      expect(emitter.emitProcessOutput.mock.calls.length).toBe(callsAfterGrowth);

      watchSpy.mockRestore();
      killSpy.mockRestore();
    });
  });

  describe("tailLogForOrphan watcher callback: entry removed", () => {
    it("closes the watcher and returns without error once the orphan has been finalized", async () => {
      vi.useFakeTimers();
      const emitter = makeEmitter();
      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );

      const logPath = join(tmpDir, "watched-2.log");
      writeFileSync(logPath, "data\n");
      writeManifest(tmpDir, "watched-2", { pid: 88888, runId: "run-watched-2" });

      let capturedCb: (() => void) | undefined;
      const watcherClose = vi.fn();
      const watchSpy = vi.spyOn(fsNS, "watch").mockImplementation((_path, cb) => {
        capturedCb = cb as () => void;
        return { close: watcherClose } as unknown as ReturnType<typeof fsNS.watch>;
      });

      let alive = true;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        if (!alive) throw new Error("ESRCH");
        return true;
      });

      runner.rehydrateOrphans();
      expect(capturedCb).toBeTypeOf("function");

      // Simulate the orphan's pid disappearing: the 5s poll finalizes it,
      // which deletes the active-process entry and closes the watcher once.
      alive = false;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(watcherClose).toHaveBeenCalledTimes(1);

      // A further fs.watch fire after finalization finds no active entry:
      // it must close the (already-closed) watcher again and return cleanly,
      // without touching any buffer or throwing.
      expect(() => capturedCb!()).not.toThrow();
      expect(watcherClose).toHaveBeenCalledTimes(2);

      watchSpy.mockRestore();
      killSpy.mockRestore();
    });

    it("falls back to pid 0 for the liveness poll once the active-process entry has already been removed", async () => {
      vi.useFakeTimers();
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);

      const logPath = join(tmpDir, "watched-3.log");
      writeFileSync(logPath, "data\n");
      writeManifest(tmpDir, "watched-3", { pid: 99999, runId: "run-watched-3" });

      const watchSpy = vi.spyOn(fsNS, "watch").mockImplementation(
        () => ({ close: vi.fn() }) as unknown as ReturnType<typeof fsNS.watch>,
      );
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the tracked entry out-of-band (simulating it having already
      // been cleaned up by some other path) before the poll interval fires.
      const anyRunner = runner as unknown as {
        activeProcesses: Map<string, unknown>;
      };
      anyRunner.activeProcesses.delete("watched-3");
      killSpy.mockClear();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(killSpy).toHaveBeenCalledWith(0, 0);

      watchSpy.mockRestore();
      killSpy.mockRestore();
    });
  });

  describe("finalizeOrphan: direct edge cases", () => {
    it("returns early without logging when the entry is already gone", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const anyRunner = runner as unknown as {
        finalizeOrphan: (processId: string) => void;
      };

      expect(() => anyRunner.finalizeOrphan("never-existed")).not.toThrow();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        "Orphaned process has exited",
      );
    });

    it("swallows a manifest read/write failure during finalization but still emits process:completed", async () => {
      vi.useFakeTimers();
      const emitter = makeEmitter();
      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );

      const logPath = join(tmpDir, "watched-4.log");
      writeFileSync(logPath, "data\n");
      const manifestPath = join(tmpDir, "watched-4.json");
      writeManifest(tmpDir, "watched-4", { pid: 11111, runId: "run-watched-4" });

      const watchSpy = vi.spyOn(fsNS, "watch").mockImplementation(
        () => ({ close: vi.fn() }) as unknown as ReturnType<typeof fsNS.watch>,
      );

      let alive = true;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        if (!alive) throw new Error("ESRCH");
        return true;
      });

      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the manifest file before the orphan is finalized so the
      // read-modify-write inside finalizeOrphan's try block throws.
      rmSync(manifestPath, { force: true });

      alive = false;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(existsSync(manifestPath)).toBe(false);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-watched-4",
        "watched-4",
        "executor",
        "claude",
        -1,
        expect.any(Number),
      );

      watchSpy.mockRestore();
      killSpy.mockRestore();
    });
  });

  describe("cleanupProcess: direct edge cases", () => {
    it("returns early without logging when the entry is already gone", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const anyRunner = runner as unknown as {
        cleanupProcess: (processId: string, exitCode: number, durationMs: number) => void;
      };
      logger.info.mockClear();

      expect(() => anyRunner.cleanupProcess("never-existed", 0, 10)).not.toThrow();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("swallows a manifest read/write failure in the close handler but still emits process:completed", async () => {
      const child = makeFakeChild(2222);
      mockSpawn.mockReturnValue(child as never);
      const emitter = makeEmitter();

      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        context: { runId: "run-cleanup", stage: "executor", runtime: "claude" },
      });

      const processId = runner.getActiveProcesses()[0]!.id;
      const manifestPath = join(tmpDir, `${processId}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      rmSync(manifestPath, { force: true });

      child.emit("close", 0);
      await promise;

      expect(existsSync(manifestPath)).toBe(false);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-cleanup",
        processId,
        "executor",
        "claude",
        0,
        expect.any(Number),
      );
    });
  });

  describe("executeReal: null exit code with a tracked (context) process", () => {
    it("persists exitCode 1 (the ?? 1 fallback) to the manifest when close fires with a null code and context is set", async () => {
      const child = makeFakeChild(3333);
      mockSpawn.mockReturnValue(child as never);
      const emitter = makeEmitter();

      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        context: { runId: "run-null-code", stage: "executor", runtime: "claude" },
      });

      const processId = runner.getActiveProcesses()[0]!.id;

      child.emit("close", null);
      const result = await promise;

      expect(result.exitCode).toBe(1);
      const manifest = JSON.parse(
        readFileSync(join(tmpDir, `${processId}.json`), "utf-8"),
      ) as { exitCode?: number };
      expect(manifest.exitCode).toBe(1);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-null-code",
        processId,
        "executor",
        "claude",
        1,
        expect.any(Number),
      );
    });
  });

  describe("executeReal: timeout with a tracked (context) process", () => {
    it("labels the timeout error with runtime/stage instead of the raw command when context is present", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild(4444);
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const resultPromise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 1000,
        context: { runId: "run-timeout-ctx", stage: "executor", runtime: "codex-cli" },
      });

      const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      child.emit("close", null);

      await assertion;
      try {
        await resultPromise;
      } catch (err) {
        expect(err).toBeInstanceOf(AgentTimeoutError);
        expect((err as AgentTimeoutError).agent).toBe("codex-cli/executor");
      }
    });
  });

  describe("appendToBuffer: large chunk emitted to the dashboard", () => {
    it("truncates the emitted chunk to its last 500 characters when the incoming text exceeds 500 chars", async () => {
      const child = makeFakeChild(5555);
      mockSpawn.mockReturnValue(child as never);
      const emitter = makeEmitter();

      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        context: { runId: "run-large-chunk", stage: "executor", runtime: "claude" },
      });

      const bigChunk = "b".repeat(600) + "[END]";
      child.stdout.emit("data", Buffer.from(bigChunk));

      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);
      const [, , emittedChunk] = emitter.emitProcessOutput.mock.calls[0]!;
      expect(emittedChunk.length).toBe(500);
      expect(emittedChunk.endsWith("[END]")).toBe(true);
      expect(emittedChunk).not.toBe(bigChunk);

      child.emit("close", 0);
      await promise;
    });
  });
});
