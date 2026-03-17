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
    private readonly logger: Logger,
  ) {}

  async run<T>(
    input: AgentInput,
    stage: Stage,
    schema: ZodType<T>,
  ): Promise<AgentOutput<T>> {
    const args = this.buildArgs(input);

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

  private buildArgs(input: AgentInput): string[] {
    const args: string[] = ["--approval-mode", "full-auto", "-q"];
    args.push(input.prompt);
    return args;
  }
}
