import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessRunner } from "../../src/runtime/processRunner.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

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

async function waitFor(check: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("ProcessRunner", () => {
  let spoolDir: string;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    spoolDir = mkdtempSync(join(tmpdir(), "process-runner-test-"));
    logger = makeLogger();
  });

  afterEach(() => {
    rmSync(spoolDir, { recursive: true, force: true });
  });

  it("creates the spool directory on construction", () => {
    const dir = join(spoolDir, "nested", "spool");
    new ProcessRunner("mock", logger as never, undefined, dir);
    expect(existsSync(dir)).toBe(true);
  });

  describe("mock mode", () => {
    it("throws when executed without a mock handler configured", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      await expect(
        runner.execute({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 }),
      ).rejects.toThrow("Mock mode enabled but no mock handler configured");
    });

    it("delegates to the configured mock handler", async () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      const handler = vi.fn().mockResolvedValue({
        stdout: "mocked",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
      } satisfies ProcessResult);
      runner.setMockHandler(handler);

      const options: ProcessSpawnOptions = { command: "claude", args: ["--x"], cwd: "/tmp", timeoutMs: 1000 };
      const result = await runner.execute(options);

      expect(handler).toHaveBeenCalledWith(options);
      expect(result.stdout).toBe("mocked");
    });
  });

  describe("real mode", () => {
    it("captures stdout, stderr, and a successful exit code", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(0)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("out");
      expect(result.stderr).toBe("err");
      expect(result.timedOut).toBe(false);
    });

    it("captures a non-zero exit code", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
      });
      expect(result.exitCode).toBe(3);
    });

    it("writes stdinData to the child process and closes stdin", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      const result = await runner.execute({
        command: process.execPath,
        args: ["-e", "process.stdin.on('data', (c) => process.stdout.write(c)); process.stdin.on('end', () => process.exit(0));"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        stdinData: "hello-stdin",
      });
      expect(result.stdout).toBe("hello-stdin");
    });

    it("rejects with AgentTimeoutError when the process exceeds its timeout", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 5000)"],
          cwd: process.cwd(),
          timeoutMs: 100,
        }),
      ).rejects.toThrow(AgentTimeoutError);
    });

    it("rejects when the command cannot be spawned", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      await expect(
        runner.execute({
          command: join(spoolDir, "does-not-exist-binary"),
          args: [],
          cwd: process.cwd(),
          timeoutMs: 2000,
        }),
      ).rejects.toThrow();
    });

    it("tracks an active process with context and removes it once complete", async () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const promise = runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 150)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const active = runner.getActiveProcesses();
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ runId: "run-1", stage: "executor", runtime: "claude-code" });
      expect(emitter.emitProcessStarted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        process.execPath,
      );

      await promise;

      expect(runner.getActiveProcesses()).toHaveLength(0);
      expect(emitter.emitProcessCompleted).toHaveBeenCalledWith(
        "run-1",
        active[0].id,
        "executor",
        "claude-code",
        0,
        expect.any(Number),
      );

      const manifestPath = join(spoolDir, `${active[0].id}.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { completedAt?: string };
      expect(manifest.completedAt).toBeDefined();
    });

    it("getProcessOutput reads from the spooled log file after the process completes", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write('logged output'); process.exit(0)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const [active] = runner.getActiveProcesses();
      await promise;

      const output = runner.getProcessOutput(active.id);
      expect(output).toContain("logged output");
    });

    it("tolerates the manifest file being missing when cleaning up on completion", async () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);

      const promise = runner.execute({
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 150)"],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const [active] = runner.getActiveProcesses();
      rmSync(join(spoolDir, `${active.id}.json`), { force: true });

      await expect(promise).resolves.toMatchObject({ exitCode: 0 });
    });

    it("getProcessOutput returns null for an unknown process id", () => {
      const runner = new ProcessRunner("real", logger as never, undefined, spoolDir);
      expect(runner.getProcessOutput("unknown-id")).toBeNull();
    });

    it("truncates the in-memory rolling buffer and emits a truncated output chunk", async () => {
      const emitter = makeEmitter();
      const runner = new ProcessRunner("real", logger as never, emitter as never, spoolDir);

      const bigChunk = "A".repeat(9000);
      const promise = runner.execute({
        command: process.execPath,
        args: ["-e", `process.stdout.write('${bigChunk}'); setTimeout(() => process.exit(0), 150)`],
        cwd: process.cwd(),
        timeoutMs: 5000,
        context: { runId: "run-1", stage: "executor", runtime: "claude-code" },
      });

      const [active] = runner.getActiveProcesses();

      await waitFor(() => emitter.emitProcessOutput.mock.calls.length > 0);

      const emittedChunk = emitter.emitProcessOutput.mock.calls[0][2] as string;
      expect(emittedChunk.length).toBeLessThanOrEqual(500);

      const midFlightOutput = runner.getProcessOutput(active.id);
      expect(midFlightOutput).not.toBeNull();
      expect((midFlightOutput ?? "").length).toBeLessThanOrEqual(8 * 1024);

      await promise;
    });
  });

  describe("rehydrateOrphans", () => {
    it("does nothing when the spool directory cannot be read", () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      rmSync(spoolDir, { recursive: true, force: true });
      expect(() => runner.rehydrateOrphans()).not.toThrow();
    });

    it("skips manifests that are already marked completed", () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      writeFileSync(
        join(spoolDir, "done.json"),
        JSON.stringify({
          id: "done",
          pid: 999999,
          command: "x",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "done.log"),
          completedAt: new Date().toISOString(),
        }),
      );
      runner.rehydrateOrphans();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        "Rehydrating orphaned agent process",
      );
    });

    it("marks a manifest crashed when its process is no longer running", () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      // PID 1 is reserved for the system's init process on Linux; an unreasonably
      // large PID is extremely unlikely to be a live process in any sandbox.
      const deadPid = 999_999_999;
      const manifestPath = join(spoolDir, "orphan.json");
      writeFileSync(
        manifestPath,
        JSON.stringify({
          id: "orphan",
          pid: deadPid,
          command: "claude",
          args: [],
          runId: "run-1",
          stage: "executor",
          runtime: "claude-code",
          startedAt: new Date().toISOString(),
          logFile: join(spoolDir, "orphan.log"),
        }),
      );

      runner.rehydrateOrphans();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "orphan", pid: deadPid }),
        "Orphaned agent process is dead, marking crashed",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        crashed?: boolean;
        exitCode?: number;
        completedAt?: string;
      };
      expect(manifest.crashed).toBe(true);
      expect(manifest.exitCode).toBe(-1);
      expect(manifest.completedAt).toBeDefined();
    });

    it("logs a warning and continues when a manifest file is corrupt", () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "bad.json"), "{not valid json");

      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "bad.json" }),
        "Failed to process manifest",
      );
    });

    it("ignores non-.json files in the spool directory", () => {
      const runner = new ProcessRunner("mock", logger as never, undefined, spoolDir);
      writeFileSync(join(spoolDir, "some.log"), "not a manifest");
      expect(() => runner.rehydrateOrphans()).not.toThrow();
      expect(readdirSync(spoolDir)).toContain("some.log");
    });
  });
});
