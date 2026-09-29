import { describe, it, expect } from "vitest";
import { resolveAgentModel, tierForStage } from "../../src/config/agentModels.js";
import type { Env } from "../../src/config/env.js";
import type { Stage } from "../../src/schemas/cliProtocol.js";

const env = {
  CLAUDE_CODE_MODEL: "claude-fable-5",
  CLAUDE_CODE_MODEL_RESEARCH: "claude-opus-4-8",
  CODEX_MODEL: "gpt-5.6-sol",
} as Env;

describe("agentModels", () => {
  it("maps lead stages to Claude Fable 5", () => {
    expect(tierForStage("planner")).toBe("lead");
    expect(tierForStage("plan-reviser")).toBe("lead");
    expect(tierForStage("executor")).toBe("lead");
    expect(tierForStage("remediation")).toBe("lead");
    expect(resolveAgentModel("planner", env)).toBe("claude-fable-5");
    expect(resolveAgentModel("executor", env)).toBe("claude-fable-5");
  });

  it("maps research stages to Claude Opus 4.8", () => {
    expect(tierForStage("answer-researcher")).toBe("research");
    expect(tierForStage("distillation")).toBe("research");
    expect(resolveAgentModel("answer-researcher", env)).toBe("claude-opus-4-8");
    expect(resolveAgentModel("distillation", env)).toBe("claude-opus-4-8");
  });

  it("maps review stages to Codex GPT-5.6 Sol", () => {
    expect(tierForStage("plan-reviewer")).toBe("review");
    expect(tierForStage("reviewer")).toBe("review");
    expect(resolveAgentModel("plan-reviewer", env)).toBe("gpt-5.6-sol");
    expect(resolveAgentModel("reviewer", env)).toBe("gpt-5.6-sol");
  });

  it("throws for a tier that falls outside the known lead/research/review set", () => {
    // STAGE_TIERS has no entry for an unrecognized stage, so tierForStage
    // returns undefined and resolveAgentModel's switch falls through to its
    // exhaustiveness-check default branch, which must throw rather than
    // silently returning an unresolved model.
    const bogusStage = "not-a-real-stage" as Stage;
    expect(() => resolveAgentModel(bogusStage, env)).toThrow(/Unknown agent model tier/);
  });
});
