import type { ZodType } from "zod";
import type { Logger } from "../utils/logger.js";
import type { ClaudeCodeRunner } from "./claudeCodeRunner.js";
import type { CodexRunner } from "./codexRunner.js";
import type { AgentInput, AgentOutput } from "./runnerTypes.js";
import type { Stage } from "../schemas/cliProtocol.js";
import type { AgentRuntime } from "../domain/types.js";

export class AgentRunner {
  constructor(
    private readonly claudeCodeRunner: ClaudeCodeRunner,
    private readonly codexRunner: CodexRunner,
    private readonly logger: Logger,
  ) {}

  async run<T>(
    runtime: AgentRuntime,
    input: AgentInput,
    stage: Stage,
    schema: ZodType<T>,
  ): Promise<AgentOutput<T>> {
    this.logger.info({ runtime, stage }, "Routing agent execution");

    switch (runtime) {
      case "claude-code":
        return this.claudeCodeRunner.run(input, stage, schema);
      case "codex":
        return this.codexRunner.run(input, stage, schema);
      default: {
        const _exhaustive: never = runtime;
        throw new Error(`Unknown runtime: ${String(_exhaustive)}`);
      }
    }
  }
}
