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
    private readonly model: string,
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
      { stage, cwd: input.workingDirectory, command: this.command, model: this.model },
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
    //   --output-format json: single JSON envelope { type, result, is_error }
    //   --output-format stream-json --verbose: NDJSON stream, last line with
    //     type "result" contains the final output
    // In either case, extract the result text for structured output parsing.
    const { text: outputText, isApiError } = this.unwrapClaudeEnvelope(result.stdout);

    if (result.exitCode !== 0 && !outputText.includes("BEGIN_STRUCTURED_OUTPUT")) {
      this.logger.error(
        {
          stage,
          exitCode: result.exitCode,
          stderr: tailSnippet(result.stderr),
          // The unwrapped model/CLI output is where the real failure cause lives
          // (e.g. "API Error: Stream idle timeout - partial response received").
          // stderr is often empty for Claude CLI failures because errors are
          // surfaced through the JSON envelope on stdout.
          outputSnippet: tailSnippet(outputText),
          ...(isApiError ? { upstreamApiError: true } : {}),
        },
        isApiError
          ? "Claude Code CLI reported upstream API error"
          : "Claude Code CLI returned non-zero exit code with no structured output",
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

  /**
   * Runs Claude Code in a read-only advisory mode for chat queries.
   *
   * Requirement 8 (issue spec): The chat endpoint MUST NOT pass
   * --dangerously-skip-permissions to the subprocess, regardless of how
   * CLAUDE_CODE_ARGS_BASE is configured. This method enforces that invariant
   * by filtering the flag out of the resolved arg list before spawning.
   */
  async chatRun(input: AgentInput, stage: string): Promise<{ text: string; durationMs: number }> {
    // Build base args then strip --dangerously-skip-permissions (req 8)
    const rawArgs = this.buildArgs(input);
    const args = rawArgs.filter((arg) => arg !== "--dangerously-skip-permissions");

    const stdinData = this.buildStdinPayload(input);

    this.logger.info(
      { stage, cwd: input.workingDirectory, command: this.command, model: this.model, chatReadOnly: true },
      "Invoking Claude Code CLI (chat/read-only mode)",
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

    const { text, isApiError } = this.unwrapClaudeEnvelope(result.stdout);

    if (result.exitCode !== 0 || isApiError) {
      this.logger.error(
        {
          stage,
          exitCode: result.exitCode,
          stderr: tailSnippet(result.stderr),
          outputSnippet: tailSnippet(text),
          ...(isApiError ? { upstreamApiError: true } : {}),
        },
        isApiError
          ? "Claude Code CLI reported upstream API error (chat)"
          : "Claude Code CLI returned non-zero exit code (chat)",
      );
      throw new Error(
        isApiError
          ? `Claude CLI API error: ${tailSnippet(text, 200)}`
          : `Claude CLI exited with code ${result.exitCode}`,
      );
    }

    return { text, durationMs: result.durationMs };
  }

  private buildArgs(input: AgentInput): string[] {
    const args = [...this.baseArgs];

    args.push("--model", this.model);

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
   *      { "type": "result", "result": "<text>", "is_error": <bool> }
   *   2. NDJSON stream (--output-format stream-json --verbose):
   *      Multiple JSON lines; the last one with type "result" has the text.
   *
   * Also surfaces the envelope's `is_error` flag so callers can distinguish a
   * model-side failure (e.g. an upstream Anthropic API stream timeout) from a
   * generic non-zero exit. When the CLI reports `is_error: true` the `result`
   * string is the human-readable failure message, NOT a model response.
   *
   * Falls back to raw output (and `isApiError: false`) if parsing fails.
   */
  private unwrapClaudeEnvelope(raw: string): { text: string; isApiError: boolean } {
    // Try single-JSON envelope first (fast path for --output-format json)
    try {
      const envelope = JSON.parse(raw) as Record<string, unknown>;
      if (typeof envelope.result === "string") {
        return { text: envelope.result, isApiError: envelope.is_error === true };
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
          return { text: obj.result, isApiError: obj.is_error === true };
        }
      } catch {
        continue;
      }
    }

    return { text: raw, isApiError: false };
  }
}

/**
 * Truncate a string to its tail, keeping the most recent characters since
 * trailing content (final API errors, last log lines) is typically the most
 * informative when diagnosing a failure.
 */
function tailSnippet(s: string, max = 500): string {
  if (s.length <= max) return s;
  return `…${s.slice(-max)}`;
}
