import type { Logger } from "../utils/logger.js";
import type { ProcessRunner } from "./processRunner.js";
import { AGENT_STAGES, type AgentRuntime } from "../domain/types.js";
import { startTimer } from "../utils/time.js";
import { PreflightError } from "../utils/errors.js";

const PROBE_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 5_000;

export interface RuntimeProbeResult {
  runtime: AgentRuntime;
  command: string;
  binaryCheck: { ok: boolean; version?: string; error?: string; durationMs: number };
  authCheck: { ok: boolean; durationMs: number; error?: string };
}

export interface PreflightResult {
  ok: boolean;
  requiredRuntimes: AgentRuntime[];
  skippedRuntimes: AgentRuntime[];
  results: RuntimeProbeResult[];
  totalDurationMs: number;
}

interface RuntimeConfig {
  command: string;
  versionArgs: string[];
  /** Args passed to the CLI for the auth probe subprocess. */
  probeArgs: string[];
  probeStdin?: string;
  /**
   * When set, auth passes if this regex matches stdout (or stderr).
   * Useful for commands like `claude auth status` that output structured text
   * rather than a PONG echo. Takes precedence over exitCodeOnly.
   */
  successPattern?: string;
  /** When true, auth check passes on exit code 0 alone (no pattern match required). */
  exitCodeOnly?: boolean;
}

const ALL_RUNTIMES: AgentRuntime[] = ["claude-code", "codex", "cursor"];

export class RuntimeHealthCheck {
  private lastResult: PreflightResult | undefined;

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly runtimeConfigs: Record<AgentRuntime, RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  static buildRuntimeConfigs(
    claudeCommand: string,
    _claudeBaseArgs: string[],
    codexCommand: string,
    codexBaseArgs: string[],
    cursorCommand: string,
  ): Record<AgentRuntime, RuntimeConfig> {
    return {
      "claude-code": {
        command: claudeCommand,
        versionArgs: ["--version"],
        // `claude auth status` reads the local session cache — instant, no API call.
        // Returns JSON; we check that "loggedIn" is true.
        probeArgs: ["auth", "status"],
        successPattern: '"loggedIn":\\s*true',
      },
      codex: {
        command: codexCommand,
        versionArgs: ["--version"],
        probeArgs: codexBaseArgs,
        probeStdin: "Respond with exactly: PONG",
      },
      cursor: {
        command: cursorCommand,
        versionArgs: ["--version"],
        probeArgs: ["status"],
        exitCodeOnly: true,
      },
    };
  }

  getRequiredRuntimes(): Set<AgentRuntime> {
    const runtimes = new Set<AgentRuntime>();
    for (const stage of Object.values(AGENT_STAGES)) {
      runtimes.add(stage.runtime);
    }
    return runtimes;
  }

  getLastResult(): PreflightResult | undefined {
    return this.lastResult;
  }

  async runPreflight(): Promise<PreflightResult> {
    const timer = startTimer();
    const required = this.getRequiredRuntimes();
    const skipped = ALL_RUNTIMES.filter((r) => !required.has(r));

    this.logger.info(
      { required: [...required], skipped },
      "Preflight: probing required agent runtimes",
    );

    const probePromises = [...required].map((runtime) => this.probeRuntime(runtime));
    const results = await Promise.all(probePromises);

    const ok = results.every((r) => r.binaryCheck.ok && r.authCheck.ok);
    const totalDurationMs = timer.elapsed();

    const preflightResult: PreflightResult = {
      ok,
      requiredRuntimes: [...required],
      skippedRuntimes: skipped,
      results,
      totalDurationMs,
    };
    this.lastResult = preflightResult;

    if (ok) {
      this.logger.info(
        { totalDurationMs, runtimes: [...required] },
        "Preflight passed: all agent runtimes are accessible and authenticated",
      );
    } else {
      const failures = results
        .filter((r) => !r.binaryCheck.ok || !r.authCheck.ok)
        .map((r) => ({
          runtime: r.runtime,
          command: r.command,
          binaryError: r.binaryCheck.ok ? undefined : r.binaryCheck.error,
          authError: r.authCheck.ok ? undefined : r.authCheck.error,
        }));
      this.logger.error(
        { failures, totalDurationMs },
        "Preflight FAILED: one or more agent runtimes are not ready",
      );
      throw new PreflightError(preflightResult);
    }

    return preflightResult;
  }

  private async probeRuntime(runtime: AgentRuntime): Promise<RuntimeProbeResult> {
    const config = this.runtimeConfigs[runtime];
    this.logger.info({ runtime, command: config.command }, "Probing runtime");

    const binaryCheck = await this.checkBinary(config);

    if (!binaryCheck.ok) {
      return {
        runtime,
        command: config.command,
        binaryCheck,
        authCheck: { ok: false, durationMs: 0, error: "Skipped: binary check failed" },
      };
    }

    const authCheck = await this.checkAuth(config);

    return { runtime, command: config.command, binaryCheck, authCheck };
  }

  private async checkBinary(config: RuntimeConfig): Promise<RuntimeProbeResult["binaryCheck"]> {
    const timer = startTimer();
    try {
      const result = await this.processRunner.execute({
        command: config.command,
        args: config.versionArgs,
        cwd: process.cwd(),
        timeoutMs: VERSION_TIMEOUT_MS,
      });

      const durationMs = timer.elapsed();

      if (result.timedOut) {
        return { ok: false, error: `Timed out after ${VERSION_TIMEOUT_MS}ms`, durationMs };
      }

      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: `Exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
          durationMs,
        };
      }

      const version = result.stdout.trim().split("\n")[0]?.slice(0, 100);
      return { ok: true, version, durationMs };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: timer.elapsed(),
      };
    }
  }

  private async checkAuth(config: RuntimeConfig): Promise<RuntimeProbeResult["authCheck"]> {
    const timer = startTimer();
    try {
      const result = await this.processRunner.execute({
        command: config.command,
        args: config.probeArgs,
        cwd: process.cwd(),
        timeoutMs: PROBE_TIMEOUT_MS,
        stdinData: config.probeStdin,
      });

      const durationMs = timer.elapsed();

      if (result.timedOut) {
        return { ok: false, durationMs, error: `Auth probe timed out after ${PROBE_TIMEOUT_MS}ms` };
      }

      const output = result.stdout + result.stderr;

      if (config.successPattern) {
        const matched = new RegExp(config.successPattern).test(output);
        if (!matched) {
          return {
            ok: false,
            durationMs,
            error: `Auth check failed: expected pattern not found in output (got: ${result.stdout.slice(0, 200)})`,
          };
        }
        return { ok: true, durationMs };
      }

      if (config.exitCodeOnly) {
        if (result.exitCode !== 0) {
          return {
            ok: false,
            durationMs,
            error: `Exit code ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 200)}`,
          };
        }
        return { ok: true, durationMs };
      }

      const hasPong = /pong/i.test(output);

      if (result.exitCode !== 0 && !hasPong) {
        return {
          ok: false,
          durationMs,
          error: `Exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        };
      }

      if (!hasPong) {
        return {
          ok: false,
          durationMs,
          error: `Auth probe did not return expected response (got ${result.stdout.slice(0, 100)})`,
        };
      }

      return { ok: true, durationMs };
    } catch (err) {
      return {
        ok: false,
        durationMs: timer.elapsed(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
