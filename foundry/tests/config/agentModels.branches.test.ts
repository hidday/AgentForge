import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

// Covers the defensive "unknown tier" branch in resolveAgentModel's switch,
// which is unreachable for any real Stage value but guards against the
// STAGE_TIERS map being extended without updating the switch.

describe("resolveAgentModel unknown tier branch", () => {
  it("throws for a stage with no configured tier", () => {
    const env = {
      CLAUDE_CODE_MODEL: "claude-fable-5",
      CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
      CODEX_MODEL: "gpt-5.6-sol",
    } as Env;

    expect(() => resolveAgentModel("not-a-real-stage" as Stage, env)).toThrow(
      /Unknown agent model tier/,
    );
  });
});
