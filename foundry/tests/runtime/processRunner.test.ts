import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Logger } from "../../src/utils/logger.js";
import type { RunEventEmitter } from "../../src/api/runEventEmitter.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

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

async function waitFor(check: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met in time");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("ProcessRunner", () => {
  let tmpDir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
    logger = makeLogger();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("executeMock / mock mode", () => {
    it("delegates to the configured mock handler and returns its result", async () => {
      const runner = new ProcessRunner("mock", logger as unknown as Logger, undefined, tmpDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "mocked-out",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        timedOut: false,
      });
      runner.setMockHandler(handler);

      const result = await runner.execute({
        command: "claude",
        args: ["--plan"],
        cwd: "/work",
        timeoutMs: 1000,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ command: "claude", args: ["--plan"], cwd: "/work" }),
      );
      expect(result.stdout).toBe("mocked-out");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("throws if mock mode is used without a handler configured", async () => {
      const runner = new ProcessRunner("mock", logger as unknown as Logger, undefined, tmpDir);

      await expect(
        runner.execute({ command: "claude", args: [], cwd: "/work", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });
  });

  describe("executeReal: successful execution", () => {
    it("collects stdout/stderr and resolves with exitCode 0 and timedOut false", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "claude",
        args: ["--foo"],
        cwd: "/work",
        timeoutMs: 60_000,
      });

      child.stdout.emit("data", Buffer.from("hello "));
      child.stdout.emit("data", Buffer.from("world"));
      child.stderr.emit("data", Buffer.from("a warning"));
      child.emit("close", 0);

      const result = await promise;

      expect(result).toEqual({
        stdout: "hello world",
        stderr: "a warning",
        exitCode: 0,
        durationMs: expect.any(Number),
        timedOut: false,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["--foo"],
        expect.objectContaining({ cwd: "/work", stdio: ["pipe", "pipe", "pipe"] }),
      );
      // no stdin data provided -> end() called, write() never called
      expect(child.stdin.end).toHaveBeenCalledTimes(1);
      expect(child.stdin.write).not.toHaveBeenCalled();
    });

    it("merges extra env vars into the spawned process environment", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        env: { FOUNDRY_TEST_VAR: "some-value" },
      });

      child.emit("close", 0);
      await promise;

      const spawnOptions = mockSpawn.mock.calls[0]![2] as { env: Record<string, string> };
      expect(spawnOptions.env.FOUNDRY_TEST_VAR).toBe("some-value");
    });
  });

  describe("executeReal: non-zero exit code", () => {
    it("resolves (does not reject) with the non-zero exitCode and timedOut false", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
      });

      child.stderr.emit("data", Buffer.from("boom"));
      child.emit("close", 3);

      const result = await promise;
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toBe("boom");
      expect(result.timedOut).toBe(false);
    });

    it("treats a null close code as exitCode 1", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
      });

      child.emit("close", null);
      const result = await promise;
      expect(result.exitCode).toBe(1);
    });
  });

  describe("executeReal: stdin handling", () => {
    it("writes stdinData to the child's stdin and ends the stream when provided", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        stdinData: "the-prompt-payload",
      });

      expect(child.stdin.write).toHaveBeenCalledWith("the-prompt-payload");
      expect(child.stdin.end).toHaveBeenCalledTimes(1);

      child.emit("close", 0);
      await promise;
    });
  });

  describe("executeReal: timeout path", () => {
    it("kills the process with SIGTERM on timeout and rejects with AgentTimeoutError", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const resultPromise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 5000,
      });
      const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      // Simulate the process actually exiting once killed.
      child.emit("close", null);
      await assertion;
    });

    it("escalates to SIGKILL 5s after SIGTERM if the process has not exited", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild();
      child.kill = vi.fn(); // never marks `killed` true -- simulates a stuck process
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const resultPromise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 1000,
      });
      const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

      await vi.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

      child.emit("close", null);
      await assertion;
    });

    it("does not escalate to SIGKILL once the process has already exited after SIGTERM", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild(); // default kill() sets child.killed = true
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const resultPromise = runner.execute({
        command: "codex",
        args: [],
        cwd: "/work",
        timeoutMs: 1000,
      });
      const assertion = expect(resultPromise).rejects.toBeInstanceOf(AgentTimeoutError);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      child.emit("close", null);
      await assertion;
    });
  });

  describe("executeReal: spawn-level error event", () => {
    it("rejects with the raw error when spawn emits 'error' (e.g. ENOENT)", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const resultPromise = runner.execute({
        command: "nonexistent-binary",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
      });

      const err = Object.assign(new Error("spawn nonexistent-binary ENOENT"), { code: "ENOENT" });
      child.emit("error", err);

      await expect(resultPromise).rejects.toBe(err);
    });

    it("cleans up the tracked process entry when spawn errors on a context-tracked process", async () => {
      const child = makeFakeChild(555);
      mockSpawn.mockReturnValue(child as never);
      const emitter = makeEmitter();

      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );
      const resultPromise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        context: { runId: "run-err", stage: "executor", runtime: "claude" },
      });

      expect(runner.getActiveProcesses()).toHaveLength(1);
      const processId = runner.getActiveProcesses()[0]!.id;

      const err = Object.assign(new Error("boom"), { code: "EACCES" });
      child.emit("error", err);

      await expect(resultPromise).rejects.toBe(err);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-err",
        processId,
        "executor",
        "claude",
        -1,
        expect.any(Number),
      );

      const manifestPath = join(tmpDir, `${processId}.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { exitCode: number };
      expect(manifest.exitCode).toBe(-1);
    });
  });

  describe("process tracking / output buffering", () => {
    it("registers an active process with context, exposes it via getActiveProcesses, and removes it on completion", async () => {
      const child = makeFakeChild(4242);
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
        context: { runId: "run-1", stage: "executor", runtime: "claude" },
      });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        pid: 4242,
        command: "claude",
        runId: "run-1",
        stage: "executor",
        runtime: "claude",
      });
      expect(typeof active[0]!.elapsedMs).toBe("number");
      const processId = active[0]!.id;

      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        processId,
        "executor",
        "claude",
        "claude",
      );

      child.stdout.emit("data", Buffer.from("partial output"));
      expect(runner.getProcessOutput(processId)).toBe("partial output");
      expect(emitter.emitProcessOutput).toHaveBeenCalledWith("run-1", processId, "partial output");

      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        processId,
        "executor",
        "claude",
        0,
        expect.any(Number),
      );

      const manifestPath = join(tmpDir, `${processId}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        exitCode: number;
        completedAt?: string;
      };
      expect(manifest.exitCode).toBe(0);
      expect(manifest.completedAt).toBeDefined();

      // Once the process is no longer active, output falls back to the on-disk log.
      await waitFor(() => {
        const output = runner.getProcessOutput(processId);
        return output !== null && output.includes("partial output");
      });
    });

    it("does not register a tracked process when no context is provided", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
      });

      expect(runner.getActiveProcesses()).toHaveLength(0);

      child.emit("close", 0);
      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("returns null from getProcessOutput for an unknown process id", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      expect(runner.getProcessOutput("does-not-exist")).toBeNull();
    });

    it("caps the in-memory rolling buffer at 8KB, keeping only the tail", async () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as never);

      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/work",
        timeoutMs: 60_000,
        context: { runId: "run-big", stage: "executor", runtime: "claude" },
      });
      const processId = runner.getActiveProcesses()[0]!.id;

      const bigChunk = "a".repeat(5000);
      child.stdout.emit("data", Buffer.from(bigChunk));
      child.stdout.emit("data", Buffer.from(bigChunk)); // total 10000 > 8192 cap

      const buffered = runner.getProcessOutput(processId);
      expect(buffered).not.toBeNull();
      expect(buffered!.length).toBeLessThanOrEqual(8 * 1024);
      expect(buffered!.endsWith("a")).toBe(true);

      child.emit("close", 0);
      await promise;
    });

    it("throttles process:output dashboard emissions to roughly once per 250ms", async () => {
      vi.useFakeTimers();
      const child = makeFakeChild();
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
        context: { runId: "run-throttle", stage: "executor", runtime: "claude" },
      });

      child.stdout.emit("data", Buffer.from("chunk1"));
      child.stdout.emit("data", Buffer.from("chunk2")); // within the 250ms throttle window
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(300);
      child.stdout.emit("data", Buffer.from("chunk3"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

      child.emit("close", 0);
      await promise;
    });
  });

  describe("rehydrateOrphans", () => {
    it("does nothing (and does not throw) when the spool directory cannot be read", () => {
      rmSync(tmpDir, { recursive: true, force: true });
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(0);
    });

    it("skips manifests that already have a completedAt timestamp", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      writeFileSync(
        join(tmpDir, "done-1.json"),
        JSON.stringify({
          id: "done-1",
          pid: 1,
          command: "claude",
          args: [],
          runId: "run-done",
          stage: "executor",
          runtime: "claude",
          startedAt: new Date().toISOString(),
          logFile: join(tmpDir, "done-1.log"),
          completedAt: new Date().toISOString(),
          exitCode: 0,
        }),
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      runner.rehydrateOrphans();
      expect(killSpy).not.toHaveBeenCalled();
      expect(runner.getActiveProcesses()).toHaveLength(0);
      killSpy.mockRestore();
    });

    it("logs a warning and continues when a manifest file contains invalid JSON", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      writeFileSync(join(tmpDir, "broken.json"), "{ not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.json" }),
        "Failed to process manifest",
      );
    });

    it("marks a manifest crashed when its pid is no longer alive", () => {
      const runner = new ProcessRunner("real", logger as unknown as Logger, undefined, tmpDir);
      const manifestPath = join(tmpDir, "dead-1.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "dead-1",
          pid: 999999,
          command: "claude",
          args: [],
          runId: "run-dead",
          stage: "executor",
          runtime: "claude",
          startedAt: new Date().toISOString(),
          logFile: join(tmpDir, "dead-1.log"),
        }),
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      runner.rehydrateOrphans();

      killSpy.mockRestore();

      expect(runner.getActiveProcesses()).toHaveLength(0);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        crashed?: boolean;
        exitCode?: number;
        completedAt?: string;
      };
      expect(manifest.crashed).toBe(true);
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "dead-1", pid: 999999 }),
        "Orphaned agent process is dead, marking crashed",
      );
    });

    it("rehydrates a live orphan, tracks it, and finalizes it once its pid disappears", async () => {
      vi.useFakeTimers();
      const emitter = makeEmitter();
      const runner = new ProcessRunner(
        "real",
        logger as unknown as Logger,
        emitter as unknown as RunEventEmitter,
        tmpDir,
      );

      const logPath = join(tmpDir, "alive-1.log");
      writeFileSync(logPath, "previous output\n");
      writeFileSync(
        join(tmpDir, "alive-1.json"),
        JSON.stringify({
          id: "alive-1",
          pid: 424242,
          command: "claude",
          args: [],
          runId: "run-alive",
          stage: "executor",
          runtime: "claude",
          startedAt: new Date().toISOString(),
          logFile: logPath,
        }),
      );

      let alive = true;
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        if (!alive) throw new Error("ESRCH");
        return true;
      });

      runner.rehydrateOrphans();

      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(runner.getActiveProcesses()[0]).toMatchObject({ pid: 424242, runId: "run-alive" });
      expect(runner.getProcessOutput("alive-1")).toBe("previous output\n");
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "claude",
        "claude",
      );

      // Next poll interval (5s) observes the pid is gone and finalizes the orphan.
      alive = false;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-alive",
        "alive-1",
        "executor",
        "claude",
        -1,
        expect.any(Number),
      );

      const manifest = JSON.parse(
        readFileSync(join(tmpDir, "alive-1.json"), "utf-8"),
      ) as { exitCode?: number; completedAt?: string };
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toBeDefined();

      killSpy.mockRestore();
    });
  });
});
