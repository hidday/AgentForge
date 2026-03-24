import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { watch } from "node:fs";
import type { Logger } from "../utils/logger.js";
import { AgentTimeoutError } from "../utils/errors.js";
import { startTimer } from "../utils/time.js";
import { generateId } from "../utils/ids.js";
import type { ProcessResult, ProcessSpawnOptions, ProcessContext } from "./runnerTypes.js";
import type { RunEventEmitter } from "../api/runEventEmitter.js";

const ROLLING_BUFFER_MAX = 8 * 1024;
const OUTPUT_THROTTLE_MS = 250;

export type MockProcessHandler = (options: ProcessSpawnOptions) => Promise<ProcessResult>;

export interface ActiveProcess {
  id: string;
  pid: number;
  command: string;
  runId: string;
  stage: string;
  runtime: string;
  startedAt: string;
  elapsedMs: number;
}

interface ActiveProcessEntry {
  id: string;
  pid: number;
  command: string;
  context: ProcessContext;
  startedAt: Date;
  rollingBuffer: string;
  logStream: WriteStream | null;
  lastEmitMs: number;
}

interface ProcessManifest {
  id: string;
  pid: number;
  command: string;
  args: string[];
  runId: string;
  stage: string;
  runtime: string;
  startedAt: string;
  logFile: string;
  completedAt?: string;
  exitCode?: number;
  durationMs?: number;
  crashed?: boolean;
}

export class ProcessRunner {
  private mockHandler: MockProcessHandler | null = null;
  private readonly activeProcesses = new Map<string, ActiveProcessEntry>();
  private readonly spoolDir: string;

  constructor(
    private readonly mode: "mock" | "real",
    private readonly logger: Logger,
    private readonly emitter?: RunEventEmitter,
    spoolDir?: string,
  ) {
    this.spoolDir = resolve(spoolDir ?? ".foundry/processes");
    mkdirSync(this.spoolDir, { recursive: true });
  }

  setMockHandler(handler: MockProcessHandler): void {
    this.mockHandler = handler;
  }

  async execute(options: ProcessSpawnOptions): Promise<ProcessResult> {
    if (this.mode === "mock") {
      return this.executeMock(options);
    }
    return this.executeReal(options);
  }

  getActiveProcesses(): ActiveProcess[] {
    const now = Date.now();
    return [...this.activeProcesses.values()].map((e) => ({
      id: e.id,
      pid: e.pid,
      command: e.command,
      runId: e.context.runId,
      stage: e.context.stage,
      runtime: e.context.runtime,
      startedAt: e.startedAt.toISOString(),
      elapsedMs: now - e.startedAt.getTime(),
    }));
  }

  getProcessOutput(processId: string): string | null {
    const entry = this.activeProcesses.get(processId);
    if (entry) return entry.rollingBuffer;

    const logPath = join(this.spoolDir, `${processId}.log`);
    try {
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8");
        return content.slice(-ROLLING_BUFFER_MAX);
      }
    } catch {
      // file not readable
    }
    return null;
  }

  rehydrateOrphans(): void {
    let manifests: string[];
    try {
      manifests = readdirSync(this.spoolDir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }

    for (const file of manifests) {
      try {
        const raw = readFileSync(join(this.spoolDir, file), "utf-8");
        const manifest = JSON.parse(raw) as ProcessManifest;
        if (manifest.completedAt) continue;

        let alive = false;
        try {
          process.kill(manifest.pid, 0);
          alive = true;
        } catch {
          alive = false;
        }

        if (alive) {
          this.logger.info(
            { processId: manifest.id, pid: manifest.pid, stage: manifest.stage },
            "Rehydrating orphaned agent process",
          );

          const logPath = join(this.spoolDir, `${manifest.id}.log`);
          const logStream = createWriteStream(logPath, { flags: "a" });

          const entry: ActiveProcessEntry = {
            id: manifest.id,
            pid: manifest.pid,
            command: manifest.command,
            context: { runId: manifest.runId, stage: manifest.stage, runtime: manifest.runtime },
            startedAt: new Date(manifest.startedAt),
            rollingBuffer: "",
            logStream,
            lastEmitMs: 0,
          };

          try {
            const existing = readFileSync(logPath, "utf-8");
            entry.rollingBuffer = existing.slice(-ROLLING_BUFFER_MAX);
          } catch {
            // no log file yet
          }

          this.activeProcesses.set(manifest.id, entry);

          this.emitter?.emitProcessStarted(
            manifest.runId,
            manifest.id,
            manifest.stage,
            manifest.runtime,
            manifest.command,
          );

          this.tailLogForOrphan(manifest.id, logPath);
        } else {
          this.logger.warn(
            { processId: manifest.id, pid: manifest.pid, stage: manifest.stage },
            "Orphaned agent process is dead, marking crashed",
          );
          manifest.completedAt = new Date().toISOString();
          manifest.exitCode = -1;
          manifest.crashed = true;
          writeFileSync(join(this.spoolDir, file), JSON.stringify(manifest, null, 2));
        }
      } catch (err) {
        this.logger.warn({ file, error: err instanceof Error ? err.message : String(err) }, "Failed to process manifest");
      }
    }
  }

  private tailLogForOrphan(processId: string, logPath: string): void {
    let lastSize = 0;
    try {
      lastSize = readFileSync(logPath).length;
    } catch {
      // file may not exist yet
    }

    const watcher = watch(logPath, () => {
      const entry = this.activeProcesses.get(processId);
      if (!entry) {
        watcher.close();
        return;
      }

      try {
        const content = readFileSync(logPath, "utf-8");
        if (content.length > lastSize) {
          const newChunk = content.slice(lastSize);
          lastSize = content.length;
          this.appendToBuffer(entry, newChunk);
        }
      } catch {
        // file read error -- ignore
      }
    });

    const pollInterval = setInterval(() => {
      try {
        process.kill(this.activeProcesses.get(processId)?.pid ?? 0, 0);
      } catch {
        clearInterval(pollInterval);
        watcher.close();
        this.finalizeOrphan(processId);
      }
    }, 5_000);
  }

  private finalizeOrphan(processId: string): void {
    const entry = this.activeProcesses.get(processId);
    if (!entry) return;

    this.activeProcesses.delete(processId);
    entry.logStream?.end();

    const manifestPath = join(this.spoolDir, `${processId}.json`);
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ProcessManifest;
      manifest.completedAt = new Date().toISOString();
      manifest.durationMs = Date.now() - entry.startedAt.getTime();
      manifest.exitCode = -1;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      // best-effort manifest update
    }

    this.emitter?.emitProcessCompleted(
      entry.context.runId,
      processId,
      entry.context.stage,
      entry.context.runtime,
      -1,
      Date.now() - entry.startedAt.getTime(),
    );

    this.logger.info({ processId, pid: entry.pid }, "Orphaned process has exited");
  }

  private async executeMock(options: ProcessSpawnOptions): Promise<ProcessResult> {
    if (!this.mockHandler) {
      throw new Error("Mock mode enabled but no mock handler configured");
    }
    this.logger.debug(
      { command: options.command, args: options.args, cwd: options.cwd },
      "Executing mock process",
    );
    return this.mockHandler(options);
  }

  private executeReal(options: ProcessSpawnOptions): Promise<ProcessResult> {
    const timer = startTimer();
    const { command, args, cwd, env: extraEnv, timeoutMs, stdinData, context } = options;

    return new Promise<ProcessResult>((resolve, reject) => {
      const mergedEnv = { ...process.env, ...extraEnv };

      this.logger.info(
        { command, args, cwd, timeoutMs, hasStdin: !!stdinData },
        "Spawning subprocess",
      );

      const child = spawn(command, args, {
        cwd,
        env: mergedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const processId = context ? generateId() : undefined;
      let entry: ActiveProcessEntry | undefined;

      if (context && processId && child.pid) {
        const logPath = join(this.spoolDir, `${processId}.log`);
        const logStream = createWriteStream(logPath, { flags: "a" });

        entry = {
          id: processId,
          pid: child.pid,
          command,
          context,
          startedAt: new Date(),
          rollingBuffer: "",
          logStream,
          lastEmitMs: 0,
        };
        this.activeProcesses.set(processId, entry);

        const manifest: ProcessManifest = {
          id: processId,
          pid: child.pid,
          command,
          args,
          runId: context.runId,
          stage: context.stage,
          runtime: context.runtime,
          startedAt: entry.startedAt.toISOString(),
          logFile: logPath,
        };
        writeFileSync(
          join(this.spoolDir, `${processId}.json`),
          JSON.stringify(manifest, null, 2),
        );

        this.emitter?.emitProcessStarted(
          context.runId,
          processId,
          context.stage,
          context.runtime,
          command,
        );
      }

      if (stdinData) {
        child.stdin.write(stdinData);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5_000);
      }, timeoutMs);

      const handleChunk = (chunk: Buffer) => {
        if (entry) {
          const text = chunk.toString("utf-8");
          this.appendToBuffer(entry, text);
          entry.logStream?.write(chunk);
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        handleChunk(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        handleChunk(chunk);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        if (processId) this.cleanupProcess(processId, -1, timer.elapsed());
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const durationMs = timer.elapsed();

        if (processId) this.cleanupProcess(processId, code ?? 1, durationMs);

        if (timedOut) {
          this.logger.warn({ command, durationMs, timeoutMs }, "Process timed out");
          reject(new AgentTimeoutError(`${command} ${args.join(" ")}`, timeoutMs));
          return;
        }

        this.logger.info({ command, exitCode: code ?? 1, durationMs }, "Process completed");

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs,
          timedOut: false,
        });
      });
    });
  }

  private appendToBuffer(entry: ActiveProcessEntry, text: string): void {
    entry.rollingBuffer += text;
    if (entry.rollingBuffer.length > ROLLING_BUFFER_MAX) {
      entry.rollingBuffer = entry.rollingBuffer.slice(-ROLLING_BUFFER_MAX);
    }

    if (!this.emitter) return;

    const now = Date.now();
    if (now - entry.lastEmitMs >= OUTPUT_THROTTLE_MS) {
      entry.lastEmitMs = now;
      const chunk = text.length > 500 ? text.slice(-500) : text;
      this.emitter.emitProcessOutput(entry.context.runId, entry.id, chunk);
    }
  }

  private cleanupProcess(processId: string, exitCode: number, durationMs: number): void {
    const entry = this.activeProcesses.get(processId);
    if (!entry) return;

    this.activeProcesses.delete(processId);
    entry.logStream?.end();

    const manifestPath = join(this.spoolDir, `${processId}.json`);
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ProcessManifest;
      manifest.completedAt = new Date().toISOString();
      manifest.exitCode = exitCode;
      manifest.durationMs = durationMs;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      // best-effort manifest update
    }

    this.emitter?.emitProcessCompleted(
      entry.context.runId,
      processId,
      entry.context.stage,
      entry.context.runtime,
      exitCode,
      durationMs,
    );
  }
}
