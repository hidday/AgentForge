import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import { PlanReviewerOutputSchema, type PlanReviewerOutput } from "../schemas/cliProtocol.js";
import type { PlanReview } from "../schemas/planReview.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { renderRelatedContextSection } from "./sections.js";
import { env } from "../config/env.js";

export class PlanReviewerAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(
    plan: Plan,
    taskBundle: TaskBundle,
    runId: string,
    options?: { operatorNote?: string },
  ): Promise<PlanReview> {
    this.logger.info(
      { runId, planVersion: plan.planVersion, hasOperatorNote: !!options?.operatorNote },
      "Starting plan reviewer agent (Codex CLI)",
    );

    const systemTemplate = loadPromptTemplate("plan-reviewer.system.md");
    const userTemplate = loadPromptTemplate("plan-reviewer.user.md");
    const relatedContextSection = renderRelatedContextSection(taskBundle.relatedContext);
    const operatorNoteSection = options?.operatorNote
      ? `## Operator Note\n\nThe operator triggered this review and left this note. Weight it heavily: if the note describes a concern the operator wants addressed in the plan, prefer \`changes_requested\` (with a finding that captures the concern) so the reviser picks it up. If the note merely confirms the plan looks correct, treat it as confirmation rather than as a blocking objection.\n\n${options.operatorNote}\n`
      : "";
    const vars = { ...taskBundle, plan, relatedContextSection, operatorNoteSection };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<PlanReviewerOutput>(
      AGENT_STAGES.planReviewer.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
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
