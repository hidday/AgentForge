import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import { PlanReviewerOutputSchema, type PlanReviewerOutput } from "../schemas/cliProtocol.js";
import type { PlanReview } from "../schemas/planReview.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export class PlanReviewerAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(plan: Plan, taskBundle: TaskBundle, runId: string): Promise<PlanReview> {
    this.logger.info(
      { runId, planVersion: plan.planVersion },
      "Starting plan reviewer agent (Codex CLI)",
    );

    const systemTemplate = loadPromptTemplate("plan-reviewer.system.md");
    const userTemplate = loadPromptTemplate("plan-reviewer.user.md");
    const vars = { ...taskBundle, plan };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<PlanReviewerOutput>(
      AGENT_STAGES.planReviewer.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
      },
      "plan-reviewer",
      PlanReviewerOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "PlanReviewerTranscript",
      version: 1,
      payloadJson: {},
      rawText: output.raw,
    });

    const planReview = output.parsed.payload;

    await this.artifactRepo.create({
      runId,
      type: "PlanReview",
      version: 1,
      payloadJson: planReview as unknown as object,
      rawText: JSON.stringify(planReview, null, 2),
    });

    this.logger.info(
      {
        runId,
        reviewId: planReview.reviewId,
        verdict: planReview.overallVerdict,
        findingsCount: planReview.findings.length,
      },
      "Plan review completed",
    );

    return planReview;
  }
}
