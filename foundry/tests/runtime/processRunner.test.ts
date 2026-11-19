import { describe, it, expect, vi, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

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

function freshSpoolDir() {
  return mkdtempSync(join(tmpdir(), "process-runner-test-"));
}

/** Spawns a node child and waits until it has definitively exited; returns its (now-dead) pid. */
async function getDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid!;
  await new Promise((resolve) => child.on("exit", resolve));
  return pid;
}

const liveChildren: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const c of liveChildren.splice(0)) {
    try {
      c.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
  vi.useRealTimers();
});

describe("ProcessRunner — mock mode", () => {
  it("delegates to the configured mock handler", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    const handler = vi.fn().mockResolvedValue({
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    runner.setMockHandler(handler);

    const opts: ProcessSpawnOptions = {
      command: "whatever",
      args: ["x"],
      cwd: "/tmp",
      timeoutMs: 1000,
    };
    const result = await runner.execute(opts);

    expect(handler).toHaveBeenCalledWith(opts);
    expect(result.stdout).toBe("mocked");
  });

  it("rejects when mock mode is enabled but no handler was configured", async () => {
    const runner = new ProcessRunner("mock", makeLogger() as never);
    await expect(
      runner.execute({ command: "x", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });
});

describe("ProcessRunner — real mode, basic execution", () => {
  it("resolves with stdout/exitCode 0 on success", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, freshSpoolDir());
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.exit(0);"],
      cwd: tmpdir(),
      timeoutMs: 5000,
    });

    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
  });

  it("resolves with the real non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, freshSpoolDir());
    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.exit(7);"],
      cwd: tmpdir(),
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(7);
  });

  it("writes stdinData to the child process's stdin", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, freshSpoolDir());
    const result = await runner.execute({
      command: process.execPath,
      args: [
        "-e",
        "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => { process.stdout.write('echo:' + d); process.exit(0); });",
      ],
      cwd: tmpdir(),
      timeoutMs: 5000,
      stdinData: "hello-stdin",
    });

    expect(result.stdout).toBe("echo:hello-stdin");
  });

  it("rejects when the command cannot be spawned", async () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, freshSpoolDir());
    await expect(
      runner.execute({
        command: "this-binary-definitely-does-not-exist-abc123",
        args: [],
        cwd: tmpdir(),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });

  it("kills the process and rejects with AgentTimeoutError when it exceeds timeoutMs", async () => {
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, freshSpoolDir());

    await expect(
      runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000);"],
        cwd: tmpdir(),
        timeoutMs: 200,
      }),
    ).rejects.toThrow(AgentTimeoutError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 200 }),
      "Process timed out",
    );
  });
});

describe("ProcessRunner — context tracking, manifests, and output retrieval", () => {
  it("tracks an active process, writes a manifest, and emits lifecycle events", async () => {
    const spoolDir = freshSpoolDir();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const resultPromise = runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok'); setTimeout(() => process.exit(0), 250);"],
      cwd: tmpdir(),
      timeoutMs: 5000,
      context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
    });

    // Give the child a moment to spawn and register itself as active.
    await new Promise((r) => setTimeout(r, 80));

    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
    expect(typeof active[0]!.pid).toBe("number");

    const processId = active[0]!.id;
    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "executor",
      "claude-code",
      process.execPath,
    );

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);

    // After completion the process is no longer active.
    expect(runner.getActiveProcesses()).toHaveLength(0);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "run-1",
      processId,
      "executor",
      "claude-code",
      0,
      expect.any(Number),
    );

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(0);

    // getProcessOutput now falls back to reading the on-disk log file.
    expect(runner.getProcessOutput(processId)).toContain("ok");
  });

  it("returns null from getProcessOutput for an unknown process id", () => {
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, freshSpoolDir());
    expect(runner.getProcessOutput("no-such-process")).toBeNull();
  });

  it("works without an emitter when context is provided", async () => {
    const spoolDir = freshSpoolDir();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);

    const result = await runner.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('fine'); process.exit(0);"],
      cwd: tmpdir(),
      timeoutMs: 5000,
      context: { runId: "run-2", stage: "planner", runtime: "codex" },
    });

    expect(result.stdout).toBe("fine");
  });

  it("truncates the live rolling buffer to 8KB while keeping the full output on disk", async () => {
    const spoolDir = freshSpoolDir();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      makeEmitter() as never,
      spoolDir,
    );

    const bigWrite = 9000;
    const resultPromise = runner.execute({
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write('A'.repeat(${bigWrite})); setTimeout(() => process.exit(0), 300);`,
      ],
      cwd: tmpdir(),
      timeoutMs: 5000,
      context: { runId: "run-3", stage: "executor", runtime: "claude-code" },
    });

    await new Promise((r) => setTimeout(r, 150));
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    const liveOutput = runner.getProcessOutput(active[0]!.id);
    expect(liveOutput).not.toBeNull();
    expect(liveOutput!.length).toBeLessThanOrEqual(8 * 1024);

    await resultPromise;

    const finalOutput = runner.getProcessOutput(active[0]!.id);
    expect(finalOutput).not.toBeNull();
    expect(finalOutput!.length).toBe(bigWrite);
  });
});

describe("ProcessRunner.rehydrateOrphans", () => {
  it("returns without error when the spool directory cannot be read", () => {
    const spoolDir = freshSpoolDir();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("skips manifests that are already marked completed", () => {
    const spoolDir = freshSpoolDir();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "done.json"),
      JSON.stringify({
        id: "done",
        pid: 123,
        command: "x",
        args: [],
        runId: "r",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "done.log"),
        completedAt: new Date().toISOString(),
      }),
    );

    runner.rehydrateOrphans();
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("marks a manifest crashed when its pid is no longer alive", async () => {
    const spoolDir = freshSpoolDir();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const deadPid = await getDeadPid();
    const manifestPath = join(spoolDir, "orphan-dead.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "orphan-dead",
        pid: deadPid,
        command: "x",
        args: [],
        runId: "r",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-dead.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-dead", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.crashed).toBe(true);
    expect(manifest.exitCode).toBe(-1);
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });

  it("logs a warning and continues when a manifest file is malformed", () => {
    const spoolDir = freshSpoolDir();
    const logger = makeLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("rehydrates an alive orphan: registers it as active and emits process-started", () => {
    const spoolDir = freshSpoolDir();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    // Avoid starting the real 5s polling/fs.watch loop in this test; it is
    // covered in isolation below.
    vi.spyOn(runner as unknown as { tailLogForOrphan: () => void }, "tailLogForOrphan").mockImplementation(
      () => {},
    );

    const logPath = join(spoolDir, "orphan-alive.log");
    writeFileSync(logPath, "previous output");
    writeFileSync(
      join(spoolDir, "orphan-alive.json"),
      JSON.stringify({
        id: "orphan-alive",
        pid: process.pid,
        command: "x",
        args: [],
        runId: "r-alive",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-alive", pid: process.pid }),
      "Rehydrating orphaned agent process",
    );
    expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
      "r-alive",
      "orphan-alive",
      "executor",
      "claude-code",
      "x",
    );
    const active = runner.getActiveProcesses();
    expect(active).toHaveLength(1);
    expect(runner.getProcessOutput("orphan-alive")).toBe("previous output");
  });
});

describe("ProcessRunner orphan polling — tailLogForOrphan / finalizeOrphan", () => {
  it("does nothing while the orphaned process is still alive", async () => {
    const spoolDir = freshSpoolDir();
    const emitter = makeEmitter();
    const runner = new ProcessRunner(
      "real",
      makeLogger() as never,
      emitter as never,
      spoolDir,
    );
    const privateRunner = runner as unknown as {
      activeProcesses: Map<string, { id: string }>;
      tailLogForOrphan: (id: string, logPath: string) => void;
    };

    const logPath = join(spoolDir, "still-alive.log");
    writeFileSync(logPath, "");
    privateRunner.activeProcesses.set("still-alive", {
      id: "still-alive",
      pid: process.pid,
      command: "x",
      context: { runId: "r", stage: "executor", runtime: "claude-code" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
    } as never);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    privateRunner.tailLogForOrphan("still-alive", logPath);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses().some((p) => p.id === "still-alive")).toBe(true);
    expect(emitter.emitProcessCompleted).not.toHaveBeenCalled();
  });

  it("finalizes the orphan once its process has actually died", async () => {
    const spoolDir = freshSpoolDir();
    const logger = makeLogger();
    const emitter = makeEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);
    const privateRunner = runner as unknown as {
      activeProcesses: Map<string, { id: string }>;
      tailLogForOrphan: (id: string, logPath: string) => void;
    };

    const deadPid = await getDeadPid();
    const logPath = join(spoolDir, "will-die.log");
    writeFileSync(logPath, "");
    const manifestPath = join(spoolDir, "will-die.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "will-die",
        pid: deadPid,
        command: "x",
        args: [],
        runId: "r-die",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: logPath,
      }),
    );
    privateRunner.activeProcesses.set("will-die", {
      id: "will-die",
      pid: deadPid,
      command: "x",
      context: { runId: "r-die", stage: "executor", runtime: "claude-code" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
    } as never);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    privateRunner.tailLogForOrphan("will-die", logPath);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getActiveProcesses().some((p) => p.id === "will-die")).toBe(false);
    expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
      "r-die",
      "will-die",
      "executor",
      "claude-code",
      -1,
      expect.any(Number),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "will-die", pid: deadPid }),
      "Orphaned process has exited",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.completedAt).toBeDefined();
    expect(manifest.exitCode).toBe(-1);
  });

  it("appends newly written log content to the rolling buffer as the file grows", async () => {
    const spoolDir = freshSpoolDir();
    const runner = new ProcessRunner("real", makeLogger() as never, undefined, spoolDir);
    const privateRunner = runner as unknown as {
      activeProcesses: Map<
        string,
        { rollingBuffer: string }
      >;
      tailLogForOrphan: (id: string, logPath: string) => void;
    };

    const logPath = join(spoolDir, "growing.log");
    writeFileSync(logPath, "start\n");
    privateRunner.activeProcesses.set("growing", {
      id: "growing",
      pid: process.pid,
      command: "x",
      context: { runId: "r", stage: "executor", runtime: "claude-code" },
      startedAt: new Date(),
      rollingBuffer: "",
      logStream: null,
      lastEmitMs: 0,
    } as never);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    privateRunner.tailLogForOrphan("growing", logPath);

    writeFileSync(logPath, "start\nmore-data\n", { flag: "a" });
    // fs.watch delivery is real-clock async; setTimeout/setImmediate are not
    // faked here (only setInterval/clearInterval are), so this really waits.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(privateRunner.activeProcesses.get("growing")!.rollingBuffer).toContain("more-data");
  });
});
