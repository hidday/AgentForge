import { spawn } from "node:child_process";
import type { Logger } from "../utils/logger.js";
import { AgentTimeoutError } from "../utils/errors.js";
import { startTimer } from "../utils/time.js";
import type { ProcessResult, ProcessSpawnOptions } from "./runnerTypes.js";

export interface MockProcessHandler {
  (options: ProcessSpawnOptions): Promise<ProcessResult>;
}

export class ProcessRunner {
  private mockHandler: MockProcessHandler | null = null;

  constructor(
    private readonly mode: "mock" | "real",
    private readonly logger: Logger,
  ) {}

  setMockHandler(handler: MockProcessHandler): void {
    this.mockHandler = handler;
  }

  async execute(options: ProcessSpawnOptions): Promise<ProcessResult> {
    if (this.mode === "mock") {
      return this.executeMock(options);
    }
    return this.executeReal(options);
  }

  private async executeMock(
    options: ProcessSpawnOptions,
  ): Promise<ProcessResult> {
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
    const { command, args, cwd, env: extraEnv, timeoutMs, stdinData } = options;

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

      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const durationMs = timer.elapsed();

        if (timedOut) {
          this.logger.warn(
            { command, durationMs, timeoutMs },
            "Process timed out",
          );
          reject(
            new AgentTimeoutError(`${command} ${args.join(" ")}`, timeoutMs),
          );
          return;
        }

        this.logger.info(
          { command, exitCode: code ?? 1, durationMs },
          "Process completed",
        );

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
}
