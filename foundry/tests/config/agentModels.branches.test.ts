import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";
import type { Env } from "../../src/config/env.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel — exhaustiveness guard", () => {
  it("throws for a stage that maps to no known tier", () => {
    // Bypass the type system the way a bad runtime payload would: cast an
    // unrecognized stage to force tierForStage() to return undefined and
    // exercise the switch statement's defensive `default` branch.
    expect(() => resolveAgentModel("not-a-real-stage" as unknown as Stage, env)).toThrow(
      /Unknown agent model tier/,
    );
  });
});
