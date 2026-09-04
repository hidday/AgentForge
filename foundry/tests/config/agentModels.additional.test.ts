import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";
import type { Env } from "../../src/config/env.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel exhaustiveness guard", () => {
  it("throws for a stage that maps to an unknown tier", () => {
    // STAGE_TIERS only has entries for real Stage values, so an unrecognized
    // stage makes tierForStage return `undefined`, which falls through every
    // switch case in resolveAgentModel to the `default` exhaustiveness branch.
    const bogusStage = "not-a-real-stage" as unknown as Stage;

    expect(() => resolveAgentModel(bogusStage, env)).toThrow(
      /Unknown agent model tier: undefined/,
    );
  });
});
