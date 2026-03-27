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

  async run<T>(
    input: AgentInput,
    stage: Stage,
    schema: ZodType<T, any, any>,
  ): Promise<AgentOutput<T>> {
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
      context: input.runId ? { runId: input.runId, stage, runtime: "claude-code" } : undefined,
    });

    // Claude CLI output varies by format:
    //   --output-format json: single JSON envelope { type, result }
    //   --output-format stream-json --verbose: NDJSON stream, last line with
    //     type "result" contains the final output
    // In either case, extract the result text for structured output parsing.
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
   * Extracts the model's text response from Claude CLI output.
   *
   * Handles two formats:
   *   1. Single JSON envelope (--output-format json):
   *      { "type": "result", "result": "<text>" }
   *   2. NDJSON stream (--output-format stream-json --verbose):
   *      Multiple JSON lines; the last one with type "result" has the text.
   *
   * Falls back to raw output if parsing fails entirely.
   */
  private unwrapClaudeEnvelope(raw: string): string {
    // Try single-JSON envelope first (fast path for --output-format json)
    try {
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      if (typeof envelope.result === "string") {
        return envelope.result;
      }
    } catch {
      // Not single JSON -- try NDJSON stream format
    }

    // NDJSON: scan lines from the end looking for {"type":"result","result":"..."}
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === "result" && typeof obj.result === "string") {
          return obj.result;
        }
      } catch {
        continue;
      }
    }

    return raw;
  }
}
