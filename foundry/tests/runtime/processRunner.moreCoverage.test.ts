import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { ProcessSpawnOptions, ProcessContext } from "../../src/runtime/runnerTypes.js";

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

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  pid: number;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

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

const baseOptions: ProcessSpawnOptions = {
  command: "do-thing",
  args: ["--flag"],
  cwd: "/tmp",
  timeoutMs: 5_000,
};

describe("ProcessRunner - additional branch coverage", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeMockLogger>;
  let killSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-more-test-"));
    logger = makeMockLogger();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    killSpy?.mockRestore();
    killSpy = undefined;
    vi.useRealTimers();
    rmSync(spoolDir, { recursive: true, force: true });
  });

  describe("getProcessOutput: unreadable log path", () => {
    it("returns null when the log path exists but cannot be read as a file (e.g. a directory)", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      // A directory at the expected log-file path makes existsSync() true but
      // readFileSync() throw (EISDIR), exercising the catch branch.
      mkdirSync(join(spoolDir, "weird-proc.log"));

      expect(runner.getProcessOutput("weird-proc")).toBeNull();
    });
  });

  describe("rehydrateOrphans: alive orphan", () => {
    it("rehydrates an alive orphan with an existing log file, tracks it, and finalizes it once its pid disappears", async () => {
      vi.useFakeTimers();
      killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

      const emitter = makeMockEmitter();
      const logPath = join(spoolDir, "alive.log");
      const manifestPath = join(spoolDir, "alive.json");
      writeFileSync(logPath, "previously logged output");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "alive",
          pid: 123456,
          command: "do-thing",
          args: ["--flag"],
          runId: "run-alive",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive", pid: 123456, stage: "executor" }),
        "Rehydrating orphaned agent process",
      );
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive",
        "executor",
        "claude-code",
        "do-thing",
      );
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(runner.getProcessOutput("alive")).toContain("previously logged output");

      // Simulate the orphaned process disappearing: the poller's process.kill
      // probe now throws, which should clear the interval, close the watcher,
      // and finalize the orphan with exitCode -1.
      killSpy.mockImplementation(() => {
        throw new Error("ESRCH: no such process");
      });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "alive",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive", pid: 123456 }),
        "Orphaned process has exited",
      );

      const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestAfter.exitCode).toBe(-1);
      expect(manifestAfter.completedAt).toBeDefined();
    });

    it("rehydrates an alive orphan that has no log file yet, without throwing", async () => {
      killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

      const emitter = makeMockEmitter();
      const logPath = join(spoolDir, "alive-nolog.log");
      const manifestPath = join(spoolDir, "alive-nolog.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "alive-nolog",
          pid: 654321,
          command: "do-thing",
          args: [],
          runId: "run-alive-2",
          stage: "planner",
          runtime: "codex",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();

      expect(runner.getActiveProcesses()).toHaveLength(1);
      // No log file existed, so the in-memory rolling buffer starts empty.
      expect(runner.getProcessOutput("alive-nolog")).toBe("");

      // Let the async log WriteStream finish opening before the spool dir is
      // torn down in afterEach, so no unhandled ENOENT surfaces later.
      await new Promise((r) => setTimeout(r, 50));
    });

    it("finalizes the orphan tolerantly when the manifest file has been removed before it dies", async () => {
      vi.useFakeTimers();
      killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);

      const emitter = makeMockEmitter();
      const logPath = join(spoolDir, "alive-nomanifest.log");
      const manifestPath = join(spoolDir, "alive-nomanifest.json");
      writeFileSync(logPath, "");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "alive-nomanifest",
          pid: 111222,
          command: "do-thing",
          args: [],
          runId: "run-alive-3",
          stage: "executor",
          runtime: "cursor",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the manifest file out from under finalizeOrphan's best-effort update.
      rmSync(manifestPath, { force: true });

      killSpy.mockImplementation(() => {
        throw new Error("ESRCH");
      });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive-3",
        "alive-nomanifest",
        "executor",
        "cursor",
        -1,
        expect.any(Number),
      );
    });
  });

  describe("real mode: rolling buffer trimming without an emitter", () => {
    it("trims the in-memory rolling buffer to the max size and tolerates having no emitter configured", async () => {
      const context: ProcessContext = { runId: "run-buf", stage: "executor", runtime: "claude-code" };
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild(7777);
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, context });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);

      // Push more than ROLLING_BUFFER_MAX (8 KiB) bytes of stdout so the
      // buffer-trimming branch runs; no emitter is configured, so the
      // "skip emitting output" branch runs too.
      const big = "y".repeat(9_000);
      child.stdout.emit("data", Buffer.from(big));

      const output = runner.getProcessOutput(active[0]!.id);
      expect(output).not.toBeNull();
      expect(output!.length).toBe(8 * 1024);
      expect(output).toBe(big.slice(-8 * 1024));

      child.emit("close", 0);
      await promise;

      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe("real mode: cleanupProcess tolerates a missing manifest file", () => {
    it("does not throw when the manifest file was removed before the process closes", async () => {
      const context: ProcessContext = { runId: "run-missing", stage: "executor", runtime: "claude-code" };
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const child = makeFakeChild(8888);
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, context });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      rmSync(manifestPath, { force: true });

      child.emit("close", 0);
      await expect(promise).resolves.toMatchObject({ exitCode: 0 });

      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-missing",
        active[0]!.id,
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );
      // Manifest file was never recreated by the best-effort update.
      expect(existsSync(manifestPath)).toBe(false);

      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
