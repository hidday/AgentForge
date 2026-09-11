import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel exhaustiveness guard", () => {
  it("throws for a stage that maps to no known tier (defensive default branch)", () => {
    // "distillation" is a valid Stage but is intentionally absent from
    // STAGE_TIERS' switch cases relevant here would still resolve; to reach
    // the `default` branch we bypass the type system with a bogus stage
    // value that isn't present in STAGE_TIERS at all, so tierForStage
    // returns undefined and the switch falls through to its exhaustive
    // default, which throws.
    expect(() => resolveAgentModel("not-a-real-stage" as Stage, env)).toThrow(
      /Unknown agent model tier/,
    );
  });
});
