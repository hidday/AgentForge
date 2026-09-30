import { describe, it, expect } from "vitest";
import { resolveAgentModel, tierForStage } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("agentModels -- exhaustiveness gap coverage", () => {
  it("throws a descriptive error when resolveAgentModel is given a stage with no mapped tier", () => {
    const bogusStage = "not-a-real-stage" as unknown as Stage;
    expect(() => resolveAgentModel(bogusStage, env)).toThrow(/Unknown agent model tier/);
  });

  it("tierForStage returns undefined for an unmapped stage", () => {
    const bogusStage = "not-a-real-stage" as unknown as Stage;
    expect(tierForStage(bogusStage)).toBeUndefined();
  });
});
