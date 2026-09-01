import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessContext } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

/** Runs `node -e <code>`, deterministic and cross-platform-safe. */
function nodeScript(code: string) {
  return { command: process.execPath, args: ["-e", code] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `check` until it returns true or `timeoutMs` elapses (then throws). */
async function waitFor(
  check: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await sleep(intervalMs);
  }
}

const context: ProcessContext = { runId: "run-1", stage: "executor", runtime: "claude-code" };

let spoolDir: string;

beforeEach(() => {
  spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
});

afterEach(() => {
  rmSync(spoolDir, { recursive: true, force: true });
});

describe("ProcessRunner — mock mode", () => {
  it("throws when execute() is called without a mock handler configured", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    await expect(
      runner.execute({ command: "echo", args: [], cwd: "/tmp", timeoutMs: 1000 }),
    ).rejects.toThrow("Mock mode enabled but no mock handler configured");
  });

  it("delegates to the configured mock handler and returns its result", async () => {
    const runner = new ProcessRunner("mock", makeMockLogger() as never, undefined, spoolDir);
    const fakeResult = {
      stdout: "mocked",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    const handler = vi.fn().mockResolvedValue(fakeResult);
    runner.setMockHandler(handler);

    const opts = { command: "echo", args: ["hi"], cwd: "/tmp", timeoutMs: 1000 };
    const result = await runner.execute(opts);

    expect(result).toBe(fakeResult);
    expect(handler).toHaveBeenCalledWith(opts);
  });
});

describe("ProcessRunner — real mode: basic exec outcomes", () => {
  it("resolves with stdout, exitCode 0 and timedOut:false on a clean successful exit", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript('console.log("hi"); process.exit(0);');

    const result = await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000 });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain("hi");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with the process's non-zero exit code", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript("process.exit(7);");

    const result = await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000 });

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr output separately from stdout", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript('console.error("oops"); process.exit(3);');

    const result = await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000 });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("oops");
    expect(result.stdout).not.toContain("oops");
  });

  it("writes stdinData to the child process and closes stdin", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript(
      'let buf = ""; process.stdin.on("data", (d) => { buf += d; }); ' +
        'process.stdin.on("end", () => { process.stdout.write("echo:" + buf); process.exit(0); });',
    );

    const result = await runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdinData: "hello-stdin",
    });

    expect(result.stdout).toBe("echo:hello-stdin");
    expect(result.exitCode).toBe(0);
  });

  it("merges extra env vars on top of process.env for the child", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript(
      "process.stdout.write(process.env.FOUNDRY_TEST_VAR || 'unset');",
    );

    const result = await runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      env: { FOUNDRY_TEST_VAR: "custom-value" },
    });

    expect(result.stdout).toBe("custom-value");
  });

  it("rejects when the command cannot be spawned (ENOENT)", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);

    await expect(
      runner.execute({
        command: "/definitely/not/a/real/binary-xyz-123",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context,
      }),
    ).rejects.toThrow();
  });
});

describe("ProcessRunner — real mode: timeout handling", () => {
  it("rejects with AgentTimeoutError, labels it by runtime/stage, and logs a warning", async () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const { command, args } = nodeScript("setTimeout(() => {}, 3000);");

    const promise = runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 150,
      context,
    });

    await expect(promise).rejects.toThrow(AgentTimeoutError);
    await expect(promise).rejects.toThrow(/claude-code\/executor/);
    await expect(promise).rejects.toThrow(/150ms/);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 150 }),
      "Process timed out",
    );
  }, 10_000);

  it("labels the timeout by command when no context is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript("setTimeout(() => {}, 3000);");

    await expect(
      runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 150 }),
    ).rejects.toThrow(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }, 10_000);
});

describe("ProcessRunner — process manifest and log file (context provided)", () => {
  it("writes a manifest synchronously on spawn and finalizes it with exitCode/durationMs on completion", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript('console.log("out1"); process.exit(0);');

    const promise = runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    // The manifest and active-process entry are created synchronously inside
    // the Promise executor, before the child has necessarily exited.
    const [active] = runner.getActiveProcesses();
    expect(active).toBeDefined();
    const processId = active!.id;
    const manifestPath = join(spoolDir, `${processId}.json`);
    expect(existsSync(manifestPath)).toBe(true);

    const initialManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(initialManifest.runId).toBe("run-1");
    expect(initialManifest.stage).toBe("executor");
    expect(initialManifest.runtime).toBe("claude-code");
    expect(initialManifest.pid).toBeGreaterThan(0);
    expect(initialManifest.completedAt).toBeUndefined();

    const result = await promise;

    const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(finalManifest.completedAt).toBeDefined();
    expect(finalManifest.exitCode).toBe(0);
    expect(finalManifest.durationMs).toBe(result.durationMs);

    const logPath = join(spoolDir, `${processId}.log`);
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain("out1");
  });

  it("does not create a manifest or log file when no context is provided", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript('console.log("no-context"); process.exit(0);');

    await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000 });

    expect(runner.getActiveProcesses()).toEqual([]);
    // No entries in the manifest dir besides the temp dir itself.
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(spoolDir)).toEqual([]);
  });
});

describe("ProcessRunner — getActiveProcesses", () => {
  it("lists a running process with correct metadata and clears it once complete", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript(
      'setTimeout(() => { console.log("done"); process.exit(0); }, 150);',
    );

    const promise = runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    const activeBefore = runner.getActiveProcesses();
    expect(activeBefore).toHaveLength(1);
    expect(activeBefore[0]).toMatchObject({
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
      command,
    });
    expect(activeBefore[0]!.pid).toBeGreaterThan(0);
    expect(activeBefore[0]!.elapsedMs).toBeGreaterThanOrEqual(0);

    await sleep(50);
    const activeMid = runner.getActiveProcesses();
    expect(activeMid[0]!.elapsedMs).toBeGreaterThanOrEqual(activeBefore[0]!.elapsedMs);

    await promise;

    expect(runner.getActiveProcesses()).toEqual([]);
  });
});

describe("ProcessRunner — getProcessOutput", () => {
  it("returns null for an unknown process id", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    expect(runner.getProcessOutput("does-not-exist")).toBeNull();
  });

  it("reads from the in-memory rolling buffer while active, then falls back to the on-disk log after completion", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const { command, args } = nodeScript(
      'process.stdout.write("partial-output"); ' +
        'setTimeout(() => { process.stdout.write("-more"); process.exit(0); }, 400);',
    );

    const promise = runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    const processId = runner.getActiveProcesses()[0]!.id;

    // Poll (well within the 400ms exit window) for the first stdout chunk to
    // arrive via the 'data' event and land in the in-memory rolling buffer.
    await waitFor(() => (runner.getProcessOutput(processId) ?? "").includes("partial-output"), 300);
    const midOutput = runner.getProcessOutput(processId);
    expect(midOutput).toContain("partial-output");

    const result = await promise;
    expect(result.stdout).toBe("partial-output-more");

    const finalOutput = runner.getProcessOutput(processId);
    expect(finalOutput).toBe("partial-output-more");
  });

  it("caps output at ROLLING_BUFFER_MAX (8KB) both in-memory and when read back from disk", async () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    const bigChunk = "A".repeat(9000) + "END_MARKER";
    const { command, args } = nodeScript(
      `process.stdout.write(${JSON.stringify(bigChunk)}); ` +
        `setTimeout(() => process.exit(0), 400);`,
    );

    const promise = runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    const processId = runner.getActiveProcesses()[0]!.id;

    // Let the large single write arrive as a 'data' event well before exit at +400ms.
    await waitFor(() => (runner.getProcessOutput(processId)?.length ?? 0) > 0, 300);
    const midOutput = runner.getProcessOutput(processId);
    expect(midOutput).not.toBeNull();
    expect(midOutput!.length).toBe(8 * 1024);
    expect(midOutput!.endsWith("END_MARKER")).toBe(true);

    await promise;

    const finalOutput = runner.getProcessOutput(processId);
    expect(finalOutput!.length).toBe(8 * 1024);
    expect(finalOutput!.endsWith("END_MARKER")).toBe(true);
  });
});

describe("ProcessRunner — emitter integration", () => {
  it("emits process:started synchronously with the expected fields", () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const { command, args } = nodeScript('console.log("x"); process.exit(0);');

    const promise = runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000, context });

    expect(emitter.emitProcessStarted).toHaveBeenCalledTimes(1);
    const [runId, processId, stage, runtime, cmd] = emitter.emitProcessStarted.mock.calls[0]!;
    expect(runId).toBe("run-1");
    expect(stage).toBe("executor");
    expect(runtime).toBe("claude-code");
    expect(cmd).toBe(command);
    expect(typeof processId).toBe("string");

    return promise;
  });

  it("emits process:completed once, with the final exitCode and durationMs", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const { command, args } = nodeScript("process.exit(4);");

    const result = await runner.execute({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
      context,
    });

    expect(emitter.emitProcessCompleted).toHaveBeenCalledTimes(1);
    const [runId, , stage, runtime, exitCode, durationMs] =
      emitter.emitProcessCompleted.mock.calls[0]!;
    expect(runId).toBe("run-1");
    expect(stage).toBe("executor");
    expect(runtime).toBe("claude-code");
    expect(exitCode).toBe(4);
    expect(durationMs).toBe(result.durationMs);
  });

  it("truncates an emitted output chunk to the last 500 characters", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const longChunk = "X".repeat(600) + "TAIL";
    const { command, args } = nodeScript(
      `process.stdout.write(${JSON.stringify(longChunk)}); process.exit(0);`,
    );

    await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000, context });

    expect(emitter.emitProcessOutput).toHaveBeenCalled();
    const emittedChunks = emitter.emitProcessOutput.mock.calls.map((c) => c[2] as string);
    const combined = emittedChunks.join("");
    expect(combined).toContain("TAIL");
    for (const chunk of emittedChunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it("throttles rapid output emissions within OUTPUT_THROTTLE_MS but emits again after the window", async () => {
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", makeMockLogger() as never, emitter as never, spoolDir);
    const { command, args } = nodeScript(
      'process.stdout.write("first"); ' +
        'setTimeout(() => process.stdout.write("second-throttled"), 30); ' +
        'setTimeout(() => { process.stdout.write("third-after-window"); process.exit(0); }, 500);',
    );

    await runner.execute({ command, args, cwd: process.cwd(), timeoutMs: 5000, context });

    const emittedChunks = emitter.emitProcessOutput.mock.calls.map((c) => c[2] as string);
    // At minimum the first ("first") and the post-window ("third-after-window")
    // writes must have produced an emitted event; the throttled middle write
    // (well within 250ms of the first) must not have produced its own event.
    expect(emittedChunks.some((c) => c.includes("first"))).toBe(true);
    expect(emittedChunks.some((c) => c.includes("third-after-window"))).toBe(true);
    expect(emittedChunks.some((c) => c.includes("second-throttled"))).toBe(false);
    expect(emittedChunks.length).toBeLessThan(3);
  }, 10_000);
});

describe("ProcessRunner — rehydrateOrphans", () => {
  it("returns silently without throwing when the spool directory cannot be read", () => {
    const runner = new ProcessRunner("real", makeMockLogger() as never, undefined, spoolDir);
    rmSync(spoolDir, { recursive: true, force: true });
    expect(() => runner.rehydrateOrphans()).not.toThrow();
  });

  it("skips manifests that already have completedAt set", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(
      join(spoolDir, "already-done.json"),
      JSON.stringify({
        id: "already-done",
        pid: 999999,
        command: "x",
        args: [],
        runId: "r",
        stage: "s",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "already-done.log"),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      }),
    );

    runner.rehydrateOrphans();

    expect(runner.getActiveProcesses()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("marks a manifest as crashed when its pid is no longer alive", async () => {
    // Spawn and fully await a short-lived child so its pid is guaranteed dead
    // (reaped) by the time rehydrateOrphans() checks it.
    const deadPid: number = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
      const pid = child.pid!;
      child.on("close", () => resolve(pid));
      child.on("error", reject);
    });

    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    const manifestPath = join(spoolDir, "orphan-1.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "orphan-1",
        pid: deadPid,
        command: "some-command",
        args: [],
        runId: "run-orphan",
        stage: "executor",
        runtime: "claude-code",
        startedAt: new Date().toISOString(),
        logFile: join(spoolDir, "orphan-1.log"),
      }),
    );

    runner.rehydrateOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ processId: "orphan-1", pid: deadPid }),
      "Orphaned agent process is dead, marking crashed",
    );

    const updated = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(updated.crashed).toBe(true);
    expect(updated.exitCode).toBe(-1);
    expect(updated.completedAt).toBeDefined();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("logs a warning and continues when a manifest file contains invalid JSON", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "broken.json"), "{ not valid json");

    expect(() => runner.rehydrateOrphans()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ file: "broken.json" }),
      "Failed to process manifest",
    );
  });

  it("ignores non-.json files in the spool directory", () => {
    const logger = makeMockLogger();
    const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
    writeFileSync(join(spoolDir, "notes.txt"), "not a manifest");

    expect(() => runner.rehydrateOrphans()).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(runner.getActiveProcesses()).toEqual([]);
  });

  it("rehydrates a still-alive orphan, tails its log, and finalizes it once the polling interval detects it has died", async () => {
    // `process.kill(pid, 0)` is used as a liveness probe both by the initial
    // rehydrate check and by tailLogForOrphan's 5s poll. Spy on it so the
    // orphan's "alive" and "died" transitions are deterministic — no real
    // long-lived child process or real 5s wait required.
    // Spy on it so the
    // orphan's "alive" and "died" transitions are deterministic — no real
    // long-lived child process or real 5s wait required.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    vi.useFakeTimers();

    const logger = makeMockLogger();
    const emitter = makeMockEmitter();
    const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

    const logPath = join(spoolDir, "orphan-alive.log");
    writeFileSync(logPath, "existing log content");

    const manifestPath = join(spoolDir, "orphan-alive.json");
    const manifest = {
      id: "orphan-alive",
      pid: 424242,
      command: "some-long-running-command",
      args: [],
      runId: "run-orphan-alive",
      stage: "executor",
      runtime: "claude-code",
      startedAt: new Date().toISOString(),
      logFile: logPath,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    try {
      runner.rehydrateOrphans();

      // Alive branch: rehydrated into activeProcesses, log tailing started,
      // process:started re-emitted, no crash logged.
      expect(runner.getActiveProcesses()).toHaveLength(1);
      expect(runner.getActiveProcesses()[0]).toMatchObject({ id: "orphan-alive", pid: 424242 });
      expect(logger.warn).not.toHaveBeenCalled();
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-orphan-alive",
        "orphan-alive",
        "executor",
        "claude-code",
        "some-long-running-command",
      );

      // Now make the liveness probe throw (process died) and advance the
      // fake clock past the 5s poll interval.
      killSpy.mockImplementation(() => {
        throw new Error("ESRCH");
      });
      vi.advanceTimersByTime(5_000);

      expect(runner.getActiveProcesses()).toEqual([]);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-orphan-alive",
        "orphan-alive",
        "executor",
        "claude-code",
        -1,
        expect.any(Number),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan-alive", pid: 424242 }),
        "Orphaned process has exited",
      );

      const finalManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(finalManifest.completedAt).toBeDefined();
      expect(finalManifest.exitCode).toBe(-1);

      // Give the real event loop a tick so the fs.watch handle closed above
      // fully tears down at the OS level before the spool dir is removed in
      // afterEach — otherwise a pending inotify/kqueue event can surface as
      // an unhandled watcher error once the directory disappears.
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      vi.useRealTimers();
      killSpy.mockRestore();
    }
  });
});
