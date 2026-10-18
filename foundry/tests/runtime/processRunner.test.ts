import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
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
  child.kill = vi.fn((signal?: string) => {
    if (signal === "SIGKILL") child.killed = true;
  });
  return child;
}

const baseOptions: ProcessSpawnOptions = {
  command: "do-thing",
  args: ["--flag"],
  cwd: "/tmp",
  timeoutMs: 5_000,
};

describe("ProcessRunner", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "processrunner-test-"));
    logger = makeMockLogger();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  describe("mock mode", () => {
    it("delegates to the registered mock handler and returns its result", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "mocked",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const result = await runner.execute(baseOptions);

      expect(handler).toHaveBeenCalledWith(baseOptions);
      expect(result.stdout).toBe("mocked");
      expect(spawn).not.toHaveBeenCalled();
    });

    it("throws when no mock handler has been configured", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      await expect(runner.execute(baseOptions)).rejects.toThrow(
        "Mock mode enabled but no mock handler configured",
      );
    });
  });

  describe("real mode: successful exit", () => {
    it("resolves with captured stdout/stderr and exit code 0", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

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
    });

    it("defaults exit code to 1 when the close code is null", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute(baseOptions);
      child.emit("close", null);

      const result = await promise;
      expect(result.exitCode).toBe(1);
    });
  });

  describe("real mode: non-zero exit code", () => {
    it("resolves (does not reject) with the non-zero exit code and captured stderr", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute(baseOptions);
      child.stderr.emit("data", Buffer.from("explosion"));
      child.emit("close", 7);

      const result = await promise;
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toBe("explosion");
      expect(result.timedOut).toBe(false);
    });
  });

  describe("real mode: stdin handling", () => {
    it("writes stdinData then ends stdin when provided", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, stdinData: "respond please" });
      expect(child.stdin.write).toHaveBeenCalledWith("respond please");
      expect(child.stdin.end).toHaveBeenCalledTimes(1);

      child.emit("close", 0);
      await promise;
    });

    it("ends stdin without writing when no stdinData is provided", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute(baseOptions);
      expect(child.stdin.write).not.toHaveBeenCalled();
      expect(child.stdin.end).toHaveBeenCalledTimes(1);

      child.emit("close", 0);
      await promise;
    });
  });

  describe("real mode: error event", () => {
    it("rejects with the spawn error", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute(baseOptions);
      const err = new Error("ENOENT: spawn failed");
      child.emit("error", err);

      await expect(promise).rejects.toBe(err);
    });
  });

  describe("real mode: timeout handling", () => {
    it("sends SIGTERM at the timeout, then SIGKILL 5s later if still alive, and rejects with AgentTimeoutError", async () => {
      vi.useFakeTimers();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      child.emit("close", null);
      await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    });

    it("does not send a second SIGKILL if the process already died after SIGTERM", async () => {
      vi.useFakeTimers();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      // Simulate a process that dies immediately on SIGTERM.
      child.kill = vi.fn(() => {
        child.killed = true;
      });
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(5_000);
      // killed was already true, so the SIGKILL fallback must not fire again.
      expect(child.kill).toHaveBeenCalledTimes(1);

      child.emit("close", 0);
      await expect(promise).rejects.toBeInstanceOf(AgentTimeoutError);
    });

    it("does not reject as a timeout when the process closes before the timeout fires", async () => {
      vi.useFakeTimers();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, timeoutMs: 10_000 });
      child.emit("close", 0);

      const result = await promise;
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);

      // Advancing time afterward must not call kill, since the timer was cleared.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(child.kill).not.toHaveBeenCalled();
    });
  });

  describe("real mode: process context tracking", () => {
    const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

    it("tracks an active process, emits lifecycle events, and writes a manifest file", async () => {
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
      const child = makeFakeChild(5555);
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute({ ...baseOptions, context });

      // While the process is active, it should show up in getActiveProcesses().
      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        pid: 5555,
        command: "do-thing",
        runId: "run-1",
        stage: "executor",
        runtime: "claude-code",
      });

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active[0]!.id,
        "executor",
        "claude-code",
        "do-thing",
      );

      const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      const manifestBefore = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestBefore.completedAt).toBeUndefined();

      child.stdout.emit("data", Buffer.from("output chunk"));
      // getProcessOutput should reflect the in-memory rolling buffer while active.
      expect(runner.getProcessOutput(active[0]!.id)).toContain("output chunk");

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

      const manifestAfter = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifestAfter.completedAt).toBeDefined();
      expect(manifestAfter.exitCode).toBe(0);

      // The per-process log file is written via an async WriteStream; give it a
      // moment to finish opening/flushing before the spool dir is torn down in
      // afterEach, so no unhandled ENOENT surfaces from a late file-system op.
      await new Promise((r) => setTimeout(r, 50));
    });

    it("does not track process state when no context is provided", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const child = makeFakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);

      const promise = runner.execute(baseOptions);
      expect(runner.getActiveProcesses()).toHaveLength(0);

      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
    });
  });

  describe("getProcessOutput", () => {
    it("returns null for an unknown process id", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(runner.getProcessOutput("does-not-exist")).toBeNull();
    });

    it("reads from the spooled log file when the process is no longer active", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "proc-1.log"), "line from disk");
      expect(runner.getProcessOutput("proc-1")).toBe("line from disk");
    });

    it("truncates log-file output to the rolling buffer max size", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const big = "x".repeat(9_000);
      writeFileSync(join(spoolDir, "proc-2.log"), big);
      const output = runner.getProcessOutput("proc-2");
      expect(output).not.toBeNull();
      expect(output!.length).toBe(8 * 1024);
      expect(output).toBe(big.slice(-8 * 1024));
    });
  });

  describe("rehydrateOrphans", () => {
    it("does nothing when the spool directory has no manifest files", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("returns silently when the spool directory cannot be read", () => {
      rmSync(spoolDir, { recursive: true, force: true });
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      // The constructor recreates the dir; remove it again to force readdirSync to fail.
      rmSync(spoolDir, { recursive: true, force: true });
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that are already marked completed", () => {
      const manifestPath = join(spoolDir, "done.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "done",
          pid: 999_999_999,
          command: "x",
          args: [],
          runId: "r",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "done.log"),
          completedAt: new Date().toISOString(),
          exitCode: 0,
        }),
      );
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();
      // Untouched: still has its original exitCode/completedAt, no warn logged.
      const after = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(after.exitCode).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("marks a manifest as crashed when its pid is no longer alive", () => {
      const deadPid = 999_999_999; // extremely unlikely to be a real, alive pid
      const manifestPath = join(spoolDir, "orphan.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "orphan",
          pid: deadPid,
          command: "x",
          args: [],
          runId: "r",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "orphan.log"),
        }),
      );
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      runner.rehydrateOrphans();

      const after = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(after.crashed).toBe(true);
      expect(after.exitCode).toBe(-1);
      expect(after.completedAt).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan", pid: deadPid }),
        "Orphaned agent process is dead, marking crashed",
      );
    });

    it("logs a warning and continues when a manifest file contains invalid JSON", () => {
      writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });
  });
});
