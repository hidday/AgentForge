import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

// Targets the exhaustiveness-check default branch in resolveAgentModel(),
// which is unreachable for any real Stage value (every Stage maps to a known
// tier in STAGE_TIERS) but still needs to be proven to throw defensively if
// an unrecognized stage ever slips through the type system (e.g. a stale
// client sending a stage string that predates a schema change).
const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel — unknown tier defensive throw", () => {
  it("throws a descriptive error for a stage that maps to no known tier", () => {
    const bogusStage = "totally-unknown-stage" as Stage;

    expect(() => resolveAgentModel(bogusStage, env)).toThrow(
      "Unknown agent model tier: undefined",
    );
  });
});
