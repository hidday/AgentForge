import type { Env } from "./env.js";
import type { Stage } from "../schemas/cliProtocol.js";

/**
 * Role tiers for model routing:
 * - lead: planner / reviser / executor / remediation / chat — Claude Fable 5
 * - research: answer researcher / distillation — Claude Opus 4.8
 * - review: plan reviewer / code reviewer — Codex GPT-5.6 Sol
 */
export type AgentModelTier = "lead" | "research" | "review";

const STAGE_TIERS: Record<Stage, AgentModelTier> = {
  planner: "lead",
  "plan-reviser": "lead",
  executor: "lead",
  remediation: "lead",
  "answer-researcher": "research",
  distillation: "research",
  "plan-reviewer": "review",
  reviewer: "review",
};

export function tierForStage(stage: Stage): AgentModelTier {
  return STAGE_TIERS[stage];
}

export function resolveAgentModel(stage: Stage, env: Env): string {
  const tier = tierForStage(stage);
  switch (tier) {
    case "lead":
      return env.CLAUDE_CODE_MODEL;
    case "research":
      return env.CLAUDE_CODE_MODEL_RESEARCH;
    case "review":
      return env.CODEX_MODEL;
    default: {
      const _exhaustive: never = tier;
      throw new Error(`Unknown agent model tier: ${String(_exhaustive)}`);
    }
  }
}
