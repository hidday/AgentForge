import { describe, it, expect } from "vitest";
import { resolveAgentModel, tierForStage } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";

const env = {
  CLAUDE_CODE_MODEL: "lead-model",
  CLAUDE_CODE_MODEL_RESEARCH: "research-model",
  CODEX_MODEL: "review-model",
} as Env;

describe("resolveAgentModel exhaustiveness guard", () => {
  it("has no tier for a stage outside the Stage union", () => {
    expect(tierForStage("not-a-stage" as never)).toBeUndefined();
  });

  it("throws a descriptive error instead of silently returning a model for an unknown stage", () => {
    expect(() => resolveAgentModel("not-a-stage" as never, env)).toThrow(
      "Unknown agent model tier: undefined",
    );
  });

  it("reads the model from the env object passed in, not the global env", () => {
    expect(resolveAgentModel("planner", env)).toBe("lead-model");
    expect(resolveAgentModel("distillation", env)).toBe("research-model");
    expect(resolveAgentModel("reviewer", env)).toBe("review-model");
  });
});
