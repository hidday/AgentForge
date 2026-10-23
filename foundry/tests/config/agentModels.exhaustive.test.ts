import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel — defensive exhaustiveness branch", () => {
  it("throws a descriptive error for a stage with no mapped tier", () => {
    // STAGE_TIERS has no entry for an unrecognized stage, so tierForStage
    // returns undefined and the switch in resolveAgentModel must fall
    // through to its `default` branch rather than silently resolving
    // to some model.
    expect(() => resolveAgentModel("totally-unknown-stage" as Stage, env)).toThrow(
      "Unknown agent model tier: undefined",
    );
  });
});
