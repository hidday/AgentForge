import { describe, it, expect } from "vitest";
import { resolveAgentModel, tierForStage } from "../../src/config/agentModels.js";
import type { AgentModelTier } from "../../src/config/agentModels.js";
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

  it("throws for an unknown tier that cannot be produced by any real Stage (defensive exhaustiveness check)", () => {
    // tierForStage is a plain lookup, so an unrecognized stage value yields
    // `undefined`, which resolveAgentModel's switch cannot match -- this
    // exercises the `default` branch's exhaustiveness guard.
    const bogusStage = "not-a-real-stage" as unknown as Stage;
    expect(tierForStage(bogusStage)).toBeUndefined();
    expect(() => resolveAgentModel(bogusStage, env)).toThrow(
      "Unknown agent model tier: undefined",
    );
  });

  it("tierForStage covers every declared Stage with a valid tier", () => {
    const stages: Stage[] = [
      "planner",
      "plan-reviser",
      "executor",
      "remediation",
      "answer-researcher",
      "distillation",
      "plan-reviewer",
      "reviewer",
    ];
    const validTiers: AgentModelTier[] = ["lead", "research", "review"];
    for (const stage of stages) {
      expect(validTiers).toContain(tierForStage(stage));
    }
  });
});
