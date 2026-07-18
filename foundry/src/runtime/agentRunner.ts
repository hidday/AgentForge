import type { ZodType } from "zod";
import type { Logger } from "../utils/logger.js";
import type { ClaudeCodeRunner } from "./claudeCodeRunner.js";
import type { CodexRunner } from "./codexRunner.js";
import type { CursorRunner } from "./cursorRunner.js";
import type { AgentInput, AgentOutput } from "./runnerTypes.js";
import type { Stage } from "../schemas/cliProtocol.js";
import type { AgentRuntime } from "../domain/types.js";
import { env } from "../config/env.js";
import { resolveAgentModel } from "../config/agentModels.js";

export class AgentRunner {
  constructor(
    private readonly claudeCodeRunner: ClaudeCodeRunner,
    private readonly codexRunner: CodexRunner,
    private readonly cursorRunner: CursorRunner,
    private readonly logger: Logger,
  ) {}

  async run<T>(
    runtime: AgentRuntime,
    input: AgentInput,
    stage: Stage,
    // Zod's Input/Def defaults need `any` for concrete ZodObject<> to be assignable at call sites.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: ZodType<T, any, any>,
  ): Promise<AgentOutput<T>> {
    const model = input.model ?? resolveAgentModel(stage, env);
    const routedInput: AgentInput = { ...input, model };

    this.logger.info({ runtime, stage, model }, "Routing agent execution");

    switch (runtime) {
      case "claude-code":
        return this.claudeCodeRunner.run(routedInput, stage, schema);
      case "codex":
        return this.codexRunner.run(routedInput, stage, schema);
      case "cursor":
        return this.cursorRunner.run(routedInput, stage, schema);
      default: {
        const _exhaustive: never = runtime;
        throw new Error(`Unknown runtime: ${String(_exhaustive)}`);
      }
    }
  }
}
