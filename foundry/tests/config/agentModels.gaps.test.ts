import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("resolveAgentModel - exhaustiveness guard", () => {
  it("throws for a stage whose tier is not one of lead/research/review", () => {
    // tierForStage is keyed by a Record<Stage, AgentModelTier>, so every real
    // Stage value maps to a known tier; this exercises the defensive
    // exhaustiveness-check default branch, only reachable by forcing a bogus
    // stage past the type system.
    expect(() => resolveAgentModel("bogus-stage" as unknown as Stage, env)).toThrow(
      "Unknown agent model tier",
    );
  });
});
