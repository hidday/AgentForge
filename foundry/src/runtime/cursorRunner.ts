import type { ZodType } from "zod";
import type { Logger } from "../utils/logger.js";
import type { ProcessRunner } from "./processRunner.js";
import { OutputParser } from "./outputParser.js";
import type { AgentInput, AgentOutput } from "./runnerTypes.js";
import type { Stage } from "../schemas/cliProtocol.js";

export class CursorRunner {
  private readonly outputParser = new OutputParser();

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly command: string,
    private readonly baseArgs: string[],
    private readonly model: string,
    private readonly logger: Logger,
  ) {}

  async run<T>(input: AgentInput, stage: Stage, schema: ZodType<T>): Promise<AgentOutput<T>> {
    const args = this.buildArgs(input);
    const stdinData = this.buildStdinPayload(input);

    this.logger.info(
      { stage, cwd: input.workingDirectory, command: this.command, model: this.model },
      "Invoking Cursor CLI",
    );

    const result = await this.processRunner.execute({
      command: this.command,
      args,
      cwd: input.workingDirectory,
      env: input.env,
      timeoutMs: input.timeoutMs,
      stdinData,
    });

    const outputText = this.unwrapJsonEnvelope(result.stdout);

    if (result.exitCode !== 0 && !outputText.includes("BEGIN_STRUCTURED_OUTPUT")) {
      this.logger.error(
        { stage, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
        "Cursor CLI returned non-zero exit code with no structured output",
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
    args.push("--model", this.model);
    args.push("--workspace", input.workingDirectory);
    return args;
  }

  private buildStdinPayload(input: AgentInput): string {
    if (input.systemPrompt) {
      return `${input.systemPrompt}\n\n---\n\n${input.prompt}`;
    }
    return input.prompt;
  }

  /**
   * When invoked with --output-format json, the Cursor CLI may wrap the
   * model's response in a JSON envelope similar to Claude Code:
   *   { "type": "result", "result": "<decoded model text>", ... }
   *
   * If the stdout is valid JSON with a `result` string field, unwrap it.
   * Otherwise return raw output unchanged.
   */
  private unwrapJsonEnvelope(raw: string): string {
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
