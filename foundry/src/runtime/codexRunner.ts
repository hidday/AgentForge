import type { ZodType } from "zod";
import type { Logger } from "../utils/logger.js";
import type { ProcessRunner } from "./processRunner.js";
import { OutputParser } from "./outputParser.js";
import type { AgentInput, AgentOutput } from "./runnerTypes.js";
import type { Stage } from "../schemas/cliProtocol.js";

export class CodexRunner {
  private readonly outputParser = new OutputParser();

  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly command: string,
    private readonly baseArgs: string[],
    private readonly logger: Logger,
  ) {}

  async run<T>(input: AgentInput, stage: Stage, schema: ZodType<T>): Promise<AgentOutput<T>> {
    const args = this.buildArgs();
    const stdinData = this.buildStdinPayload(input);

    this.logger.info(
      { stage, cwd: input.workingDirectory, command: this.command },
      "Invoking Codex CLI",
    );

    const result = await this.processRunner.execute({
      command: this.command,
      args,
      cwd: input.workingDirectory,
      env: input.env,
      timeoutMs: input.timeoutMs,
      stdinData,
    });

    if (result.exitCode !== 0 && !result.stdout.includes("BEGIN_STRUCTURED_OUTPUT")) {
      this.logger.error(
        { stage, exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
        "Codex CLI returned non-zero exit code with no structured output",
      );
    }

    const parsed = this.outputParser.parse(result.stdout, schema);

    return {
      raw: result.stdout,
      parsed,
      success: result.exitCode === 0,
      stage,
      durationMs: result.durationMs,
    };
  }

  private buildArgs(): string[] {
    // Prompt is passed via stdin, not as a positional CLI argument, to
    // avoid shell-length limits and leaking content through ps output.
    return [...this.baseArgs];
  }

  private buildStdinPayload(input: AgentInput): string {
    // Codex has no --system-prompt flag (unlike Claude). Prepend the system
    // prompt to the stdin payload so the model receives role instructions and
    // the structured-output format spec before the user task.
    if (input.systemPrompt) {
      return `${input.systemPrompt}\n\n---\n\n${input.prompt}`;
    }
    return input.prompt;
  }
}
