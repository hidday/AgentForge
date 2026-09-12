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
  it("throws a descriptive error for a stage with no known tier mapping", () => {
    expect(() => resolveAgentModel("not-a-real-stage" as Stage, env)).toThrow(
      /Unknown agent model tier/,
    );
  });
});
