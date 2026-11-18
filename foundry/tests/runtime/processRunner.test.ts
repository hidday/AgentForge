import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// `watch` is mocked (rather than exercising real inotify/FSEvents) so the
// log-tailing callback for rehydrated orphans can be driven deterministically
// instead of depending on real filesystem event timing.
const watchMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, watch: watchMock };
});

import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

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

function makeSpoolDir(): string {
  return mkdtempSync(join(tmpdir(), "process-runner-test-"));
}

describe("ProcessRunner.execute — mock mode", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("throws when mode is 'mock' and no handler has been configured", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, makeSpoolDir());

    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and logs the call", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("mock", logger as never, undefined, makeSpoolDir());
    const result: ProcessResult = {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(result);
    runner.setMockHandler(handler);

    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const out = await runner.execute(options);

    expect(out).toBe(result);
    expect(handler).toHaveBeenCalledWith(options);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ command: "claude", args: ["--print"], cwd: "/tmp" }),
      "Executing mock process",
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner.execute — real mode", () => {
  let spoolDir: string;
  let fakeChild: FakeChild;

  // Temp spool dirs are deliberately left on disk rather than cleaned up in
  // afterEach: ProcessRunner's log writer opens its file asynchronously, and
  // removing the directory before that open settles would make this test
  // suite flaky with spurious ENOENT errors unrelated to what's under test.
  // The OS reclaims these tiny temp dirs on its own.
  beforeEach(() => {
    spoolDir = makeSpoolDir();
    fakeChild = new FakeChild();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild);
  });

  it("spawns with merged env, pipes stdio, and resolves with concatenated stdout/stderr on a clean exit", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 5000,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      ["--print"],
      expect.objectContaining({
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
    // No context => no spool files, no emitter calls, no active-process entry.
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(fakeChild.stdin.end).toHaveBeenCalledOnce();
    expect(fakeChild.stdin.write).not.toHaveBeenCalled();

    fakeChild.stdout.emit("data", Buffer.from("hello "));
    fakeChild.stdout.emit("data", Buffer.from("world"));
    fakeChild.stderr.emit("data", Buffer.from("warn"));
    fakeChild.emit("close", 0);

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
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      stdinData: "prompt text",
    });

    expect(fakeChild.stdin.write).toHaveBeenCalledWith("prompt text");
    expect(fakeChild.stdin.end).toHaveBeenCalledOnce();

    fakeChild.emit("close", 0);
    await promise;
  });

  it("resolves (does not reject) with the given exit code on a non-zero, non-timeout exit", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "codex", args: [], cwd: "/tmp", timeoutMs: 5000 });
    fakeChild.emit("close", 2);

    const result = await promise;
    expect(result.exitCode).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it("defaults exitCode to 1 when the close code is null", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "codex", args: [], cwd: "/tmp", timeoutMs: 5000 });
    fakeChild.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects when the child process emits an 'error' event", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({ command: "bogus", args: [], cwd: "/tmp", timeoutMs: 5000 });
    const err = new Error("ENOENT: spawn bogus");
    fakeChild.emit("error", err);

    await expect(promise).rejects.toBe(err);
  });

  it("cleanupProcess is a no-op if it somehow runs again after the entry is already gone", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1c", stage: "executor", runtime: "claude-code" },
    });

    fakeChild.emit("close", 0);
    await promise;
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);

    // An out-of-order 'error' after 'close' re-enters cleanupProcess for a
    // processId whose entry was already removed; it must stay a no-op.
    fakeChild.emit("error", new Error("late error"));
    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
  });

  it("creates a spool manifest + log file, registers an active process, and emits start/complete when context is given", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: ["--print"],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      pid: 4242,
      command: "claude",
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    });
    expect(typeof active[0]!.elapsedMs).toBe("number");

    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      "claude",
    );

    const manifestPath = join(spoolDir, `${active[0]!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { completedAt?: string };
    expect(manifest.completedAt).toBeUndefined();

    fakeChild.stdout.emit("data", Buffer.from("partial output"));
    fakeChild.emit("close", 0);
    await promise;

    // cleanupProcess should have removed the active entry and finalized the manifest.
    expect(runner.getActiveProcesses()).toEqual([]);
    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
    };
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      active[0]!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("cleanupProcess best-effort continues when the manifest file is missing at completion time", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-1b", stage: "executor", runtime: "claude-code" },
    });

    const [active] = runner.getActiveProcesses();
    const manifestPath = join(spoolDir, `${active!.id}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    rmSync(manifestPath, { force: true });

    fakeChild.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1b",
      active!.id,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );
  });

  it("getProcessOutput returns the rolling buffer for an active process and trims it to the max size", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "executor", runtime: "claude-code" },
    });
    const [active] = runner.getActiveProcesses();

    const bigChunk = "x".repeat(9000);
    fakeChild.stdout.emit("data", Buffer.from(bigChunk));

    const output = runner.getProcessOutput(active!.id);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output!.endsWith("x")).toBe(true);

    fakeChild.emit("close", 0);
    await promise;
  });

  it("throttles emitProcessOutput so rapid chunks within the window emit once, and a later chunk after the window emits again", async () => {
    vi.useFakeTimers();
    try {
      const logger = makeMockLogger();
      const emitter = makeMockEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: "claude",
        args: [],
        cwd: "/tmp",
        timeoutMs: 60_000,
        context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
      });

      fakeChild.stdout.emit("data", Buffer.from("chunk1"));
      fakeChild.stdout.emit("data", Buffer.from("chunk2"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(300);
      fakeChild.stdout.emit("data", Buffer.from("chunk3"));
      expect(emitter.emitProcessOutput).toHaveBeenCalledTimes(2);

      fakeChild.emit("close", 0);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits only the last 500 chars of a large chunk via emitProcessOutput", async () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 60_000,
      context: { runId: "run-4", stage: "executor", runtime: "claude-code" },
    });

    const chunk = "y".repeat(600);
    fakeChild.stdout.emit("data", Buffer.from(chunk));

    expect(emitter.emitProcessOutput).toHaveBeenCalledWith(
      "run-4",
      expect.any(String),
      "y".repeat(500),
    );

    fakeChild.emit("close", 0);
    await promise;
  });

  describe("timeout handling", () => {
    it("sends SIGTERM then SIGKILL when the process doesn't exit in time, and rejects with AgentTimeoutError", async () => {
      vi.useFakeTimers();
      try {
        const logger = makeMockLogger();
        const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

        const promise = runner.execute({
          command: "claude",
          args: [],
          cwd: "/tmp",
          timeoutMs: 1000,
          context: { runId: "run-5", stage: "executor", runtime: "claude-code" },
        });

        vi.advanceTimersByTime(1000);
        expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

        // Child never actually exits (killed stays false) -> SIGKILL follows after 5s.
        vi.advanceTimersByTime(5000);
        expect(fakeChild.kill).toHaveBeenCalledWith("SIGKILL");

        fakeChild.emit("close", null);
        await expect(promise).rejects.toThrow(AgentTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not send SIGKILL if the child reports killed=true after SIGTERM", async () => {
      vi.useFakeTimers();
      try {
        const logger = makeMockLogger();
        const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

        const promise = runner.execute({
          command: "claude",
          args: [],
          cwd: "/tmp",
          timeoutMs: 1000,
        });

        vi.advanceTimersByTime(1000);
        expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
        fakeChild.killed = true;

        vi.advanceTimersByTime(5000);
        expect(fakeChild.kill).not.toHaveBeenCalledWith("SIGKILL");

        fakeChild.emit("close", null);
        await expect(promise).rejects.toThrow(AgentTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reject with AgentTimeoutError when the process exits before the timeout fires", async () => {
      const logger = makeMockLogger();
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 5000 });
      fakeChild.emit("close", 0);

      const result = await promise;
      expect(result.timedOut).toBe(false);
    });
  });
});

describe("ProcessRunner.getProcessOutput — not an active process", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = makeSpoolDir();
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("returns null when there is no active process and no log file", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    expect(runner.getProcessOutput("unknown-id")).toBeNull();
  });

  it("reads the tail of the on-disk log file when the process is no longer active", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const content = "z".repeat(9000);
    writeFileSync(join(spoolDir, "proc-1.log"), content);

    const output = runner.getProcessOutput("proc-1");
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(8 * 1024);
    expect(output).toBe(content.slice(-8 * 1024));
  });

  it("returns null when the log file exists but cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    // Make "proc-2.log" a directory so readFileSync() throws (EISDIR).
    mkdirSync(join(spoolDir, "proc-2.log"));

    expect(runner.getProcessOutput("proc-2")).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  let spoolDir: string;

  beforeEach(() => {
    spoolDir = makeSpoolDir();
  });

  it("returns silently when the spool directory cannot be read", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that are already marked completed", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    writeFileSync(
      join(spoolDir, "done-1.json"),
      JSON.stringify({
        id: "done-1",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-x",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done-1.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
  });

  it("marks a manifest as crashed when its pid is no longer alive", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    // A pid astronomically unlikely to be alive in the test sandbox.
    const deadPid = 999_999;
    const manifestPath = join(spoolDir, "dead-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "dead-1",
        pid: deadPid,
        command: "claude",
        args: [],
        runId: "run-y",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "dead-1.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessStarted).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "dead-1", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      completedAt?: string;
      exitCode?: number;
      crashed?: boolean;
    };
    expect(updated.completedAt).toBeDefined();
    expect(updated.exitCode).toBe(-1);
    expect(updated.crashed).toBe(true);
  });

  it("logs a warning and continues when a manifest file is malformed JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    writeFileSync(join(spoolDir, "broken.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphan, tails new log output via the (mocked) watcher, and cleans up on death", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-1.log");
    writeFileSync(logPath, "previously buffered output");
    writeFileSync(
      join(spoolDir, "alive-1.json"),
      JSON.stringify({
        id: "alive-1",
        pid: process.pid, // our own test process pid is always alive
        command: "claude",
        args: ["--print"],
        runId: "run-z",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const watcherClose = vi.fn();
    let watchCallback: (() => void) | undefined;
    watchMock.mockReset();
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });

    // The orphan rehydration poll uses a real 5s setInterval internally, so
    // fake timers must be in place *before* rehydrateOrphans() schedules it.
    // process.kill is used both for rehydrateOrphans' one-shot "is it alive?"
    // check (must succeed) and for every later poll tick (made to fail here,
    // simulating the process dying so the interval/watcher clean themselves
    // up instead of leaking past this test).
    vi.useFakeTimers();
    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      killCalls += 1;
      if (killCalls === 1) return true;
      throw new Error("ESRCH");
    });

    try {
      runner.rehydrateOrphans();

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: "alive-1", pid: process.pid, runId: "run-z" });
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-z",
        "alive-1",
        "executor",
        "claude-code",
        "claude",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "alive-1", pid: process.pid }),
        "Rehydrating orphaned agent process",
      );
      expect(runner.getProcessOutput("alive-1")).toBe("previously buffered output");
      expect(watchCallback).toBeDefined();

      // Simulate the OS firing a change event after more output is appended.
      appendFileSync(logPath, " EXTRA");
      watchCallback!();
      expect(runner.getProcessOutput("alive-1")).toBe("previously buffered output EXTRA");

      // A change event firing when the content hasn't grown is a no-op.
      watchCallback!();
      expect(runner.getProcessOutput("alive-1")).toBe("previously buffered output EXTRA");

      vi.advanceTimersByTime(5_000);
    } finally {
      vi.useRealTimers();
      killSpy.mockRestore();
    }

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-z",
      "alive-1",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    // The poll's own death handling already closed the watcher once; firing
    // the (mocked) watch callback again after the entry is gone exercises
    // the callback's own "no active entry" guard, which also closes it.
    const closeCallsBeforeExtraFire = watcherClose.mock.calls.length;
    watchCallback!();
    expect(watcherClose.mock.calls.length).toBe(closeCallsBeforeExtraFire + 1);
  });

  it("stringifies a non-Error throw while processing a manifest", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

    const sentinel = "SENTINEL_MANIFEST_CONTENT";
    writeFileSync(join(spoolDir, "weird.json"), sentinel);

    const originalParse = JSON.parse.bind(JSON);
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text: string) => {
      if (text === sentinel) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "raw manifest failure";
      }
      return originalParse(text);
    });

    try {
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    } finally {
      parseSpy.mockRestore();
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "weird.json", error: "raw manifest failure" }),
      "Failed to process manifest",
    );
  });

  it("tolerates a not-yet-existing log file at rehydration time and a disappearing log file mid-watch", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-3.log");
    // Deliberately do NOT pre-create the log file: createWriteStream() opens
    // it asynchronously, so the synchronous reads rehydrateOrphans/
    // tailLogForOrphan attempt right after must tolerate ENOENT.
    writeFileSync(
      join(spoolDir, "alive-3.json"),
      JSON.stringify({
        id: "alive-3",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-v",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    const watcherClose = vi.fn();
    let watchCallback: (() => void) | undefined;
    watchMock.mockReset();
    watchMock.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return { close: watcherClose };
    });

    vi.useFakeTimers();
    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      killCalls += 1;
      if (killCalls === 1) return true;
      throw new Error("ESRCH");
    });

    try {
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(watchCallback).toBeDefined();

      // The log file may or may not exist yet depending on how far the
      // async open() has gotten; force it gone either way so the watch
      // callback's own readFileSync is forced into its catch branch too.
      rmSync(logPath, { force: true });
      expect(() => watchCallback!()).not.toThrow();

      vi.advanceTimersByTime(5_000);
    } finally {
      vi.useRealTimers();
      killSpy.mockRestore();
    }

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-v",
      "alive-3",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
  });

  it("finalizeOrphan best-effort continues when the manifest file is missing at death time", () => {
    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "alive-2.log");
    const manifestPath = join(spoolDir, "alive-2.json");
    writeFileSync(logPath, "log");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "alive-2",
        pid: process.pid,
        command: "claude",
        args: [],
        runId: "run-w",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    watchMock.mockReset();
    watchMock.mockImplementation(() => ({ close: vi.fn() }));

    vi.useFakeTimers();
    let killCalls = 0;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      killCalls += 1;
      if (killCalls === 1) return true;
      throw new Error("ESRCH");
    });

    try {
      runner.rehydrateOrphans();
      expect(runner.getActiveProcesses()).toHaveLength(1);

      // Remove the manifest file before the orphan is detected as dead, so
      // finalizeOrphan's manifest read/write is forced into its catch branch.
      rmSync(manifestPath, { force: true });

      vi.advanceTimersByTime(5_000);
    } finally {
      vi.useRealTimers();
      killSpy.mockRestore();
    }

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-w",
      "alive-2",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "alive-2" }),
      "Orphaned process has exited",
    );
  });
});
