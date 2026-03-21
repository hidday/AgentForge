import type { ZodType } from "zod";
import type { Logger } from "../utils/logger.js";
import type { ProcessRunner } from "./processRunner.js";
import { OutputParser } from "./outputParser.js";
import type { AgentInput, AgentOutput } from "./runnerTypes.js";
import type { Stage } from "../schemas/cliProtocol.js";

export class ClaudeCodeRunner {
  private readonly outputParser = new OutputParser();

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly command: string,
    private readonly baseArgs: string[],
    private readonly logger: Logger,
  ) {}

  async run<T>(input: AgentInput, stage: Stage, schema: ZodType<T>): Promise<AgentOutput<T>> {
    const args = this.buildArgs(input);
    const stdinData = this.buildStdinPayload(input);

    this.logger.info(
      { stage, cwd: input.workingDirectory, command: this.command },
      "Invoking Claude Code CLI",
    );

    const result = await this.processRunner.execute({
      command: this.command,
      args,
      cwd: input.workingDirectory,
      env: input.env,
      timeoutMs: input.timeoutMs,
      stdinData,
    });

    // When running with --output-format json, Claude wraps the response in a
    // JSON envelope: { type, result: "<actual text>", ... }. The actual model
    // output lives in the `result` string field (fully decoded, no escaping).
    // We must unwrap it before searching for BEGIN_STRUCTURED_OUTPUT, otherwise
    // the parser operates on JSON-escaped content where \" and \n are still
    // raw escape sequences and the extracted block cannot be parsed as JSON.
    const outputText = this.unwrapClaudeEnvelope(result.stdout);

    if (result.exitCode !== 0 && !outputText.includes("BEGIN_STRUCTURED_OUTPUT")) {
      this.logger.error(
        { stage, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
        "Claude Code CLI returned non-zero exit code with no structured output",
      );
    }

    const parsed = this.outputParser.parse(outputText, schema);

    return {
      raw: outputText,
      parsed,
      success: result.exitCode === 0,
      stage,
      durationMs: result.durationMs,
    };
  }

  private buildArgs(input: AgentInput): string[] {
    const args = [...this.baseArgs];

    if (input.systemPrompt) {
      args.push("--system-prompt", input.systemPrompt);
    }

    // Prompt is passed via stdin, not as a CLI argument, to avoid
    // shell-length limits and leaking content through process listings.

    return args;
  }

  private buildStdinPayload(input: AgentInput): string {
    return input.prompt;
  }

  /**
   * When invoked with --output-format json, the Claude CLI wraps the model's
   * response inside a JSON envelope:
   *   { "type": "result", "result": "<decoded model text>", ... }
   *
   * The `result` field is a fully decoded string (real newlines, unescaped
   * quotes), so structured-output delimiters and JSON payloads inside it can
   * be extracted and parsed directly.
   *
   * If the stdout is not a valid JSON envelope (e.g. plain-text mode or an
   * early error message), the raw string is returned unchanged so the caller
   * still gets a useful error from the OutputParser.
   */
  private unwrapClaudeEnvelope(raw: string): string {
    try {
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      if (typeof envelope.result === "string") {
        return envelope.result;
      }
    } catch {
      // Not JSON — fall through and return raw output as-is
    }
    return raw;
  }
}
