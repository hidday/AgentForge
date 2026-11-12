import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel — exhaustiveness guard", () => {
  it("throws a descriptive error when the stage maps to an unknown tier", () => {
    // STAGE_TIERS has no entry for this stage, so tierForStage returns
    // undefined and resolveAgentModel's switch falls through to `default`.
    expect(() => resolveAgentModel("not-a-real-stage" as Stage, env)).toThrow(
      "Unknown agent model tier: undefined",
    );
  });
});
