import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirrors processRunner.test.ts's mocking setup exactly (spawn + fs.watch),
// leaving every other fs function real so manifest/log files land on a real
// temp directory.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, watch: vi.fn() };
});

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { ProcessRunner } from "../../src/runtime/processRunner.js";

const spawnMock = vi.mocked(spawn);
const watchMock = vi.mocked(watch);

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

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-gaps-test-"));
  spawnMock.mockReset();
  watchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner.getProcessOutput — unreadable log file", () => {
  it("returns null (not throw) when the on-disk log path exists but cannot be read as a file", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const processId = "weird-entry";
    // Create a directory where a .log file is expected: existsSync() is true,
    // but readFileSync() throws EISDIR.
    mkdirSync(join(spoolDir, `${processId}.log`));

    expect(runner.getProcessOutput(processId)).toBeNull();
  });
});

describe("ProcessRunner.rehydrateOrphans — log file not yet present on disk", () => {
  it("seeds an empty rollingBuffer and does not throw when the orphan's log file does not exist yet", () => {
    const processId = "alive-no-log";
    const manifestPath = join(spoolDir, `${processId}.json`);
    // Deliberately do NOT create `${processId}.log` before rehydrating.
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 7778,
        command: "claude",
        args: [],
        runId: "run-no-log",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, `${processId}.log`),
      }),
    );

    watchMock.mockReturnValue({ close: vi.fn() } as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(runner.getActiveProcesses()).toHaveLength(1);
    expect(runner.getProcessOutput(processId)).toBe("");
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-no-log",
      processId,
      "executor",
      "claude-code",
      "claude",
    );

    killSpy.mockRestore();
  });
});

describe("ProcessRunner's orphan log tailer — read failure on the watcher callback", () => {
  it("ignores a read failure inside the watch callback (log file removed mid-tail)", () => {
    const processId = "tail-read-fail";
    const logPath = join(spoolDir, `${processId}.log`);
    const manifestPath = join(spoolDir, `${processId}.json`);
    writeFileSync(logPath, "line1\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 7779,
        command: "claude",
        args: [],
        runId: "run-tail-fail",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    let capturedWatchCallback: (() => void) | undefined;
    watchMock.mockImplementation((_path, cb) => {
      capturedWatchCallback = cb as () => void;
      return { close: vi.fn() } as never;
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getProcessOutput(processId)).toBe("line1\n");

    // Remove the log file out from under the watcher, then fire the callback:
    // readFileSync inside it should throw and be swallowed silently.
    rmSync(logPath);
    expect(capturedWatchCallback).toBeDefined();
    expect(() => capturedWatchCallback!()).not.toThrow();

    // Buffer is unchanged since the read failed.
    expect(runner.getProcessOutput(processId)).toBe("line1\n");

    killSpy.mockRestore();
  });
});

describe("ProcessRunner.finalizeOrphan — missing manifest file", () => {
  it("still finalizes (emits completed, stops tracking) when the manifest file is missing at finalize time", async () => {
    vi.useFakeTimers();

    const processId = "finalize-no-manifest";
    const logPath = join(spoolDir, `${processId}.log`);
    const manifestPath = join(spoolDir, `${processId}.json`);
    writeFileSync(logPath, "line1\n");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: processId,
        pid: 7780,
        command: "claude",
        args: [],
        runId: "run-finalize",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    watchMock.mockImplementation(() => ({ close: vi.fn() }) as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(1);

    // Manifest disappears before the poll detects the process has died.
    rmSync(manifestPath);
    killSpy.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-finalize",
      processId,
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );

    killSpy.mockRestore();
  });
});

describe("ProcessRunner.cleanupProcess — missing manifest file", () => {
  it("still completes the process (resolves, emits completed) when the manifest file is missing at close time", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", makeLogger() as never, emitter as never, spoolDir);

    const promise = runner.execute({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      context: { runId: "run-cleanup", stage: "planner", runtime: "claude-code" },
    });

    const active = runner.getActiveProcesses()[0]!;
    const manifestPath = join(spoolDir, `${active.id}.json`);
    expect(() => readFileSync(manifestPath, "utf-8")).not.toThrow();
    rmSync(manifestPath);

    child.emit("close", 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(runner.getActiveProcesses()).toEqual([]);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-cleanup",
      active.id,
      "planner",
      "claude-code",
      0,
      expect.any(Number),
    );
  });
});
