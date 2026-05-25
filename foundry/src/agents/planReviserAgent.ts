import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import type { PlanReview } from "../schemas/planReview.js";
import type { PlanRevision } from "../schemas/planRevision.js";
import { PlanReviserOutputSchema, type PlanReviserOutput } from "../schemas/cliProtocol.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { renderRelatedContextSection } from "./sections.js";
import { env } from "../config/env.js";

export interface PlanRevisionResult {
  revision: PlanRevision;
  revisedPlan: Plan;
}

export class PlanReviserAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(
    plan: Plan,
    planReview: PlanReview,
    taskBundle: TaskBundle,
    runId: string,
    options?: { operatorNote?: string },
  ): Promise<PlanRevisionResult> {
    this.logger.info(
      {
        runId,
        planVersion: plan.planVersion,
        reviewId: planReview.reviewId,
        findings: planReview.findings.length,
        hasOperatorNote: !!options?.operatorNote,
      },
      "Starting plan reviser agent (Claude CLI, boss mode)",
    );

    const systemTemplate = loadPromptTemplate("plan-reviser.system.md");
    const userTemplate = loadPromptTemplate("plan-reviser.user.md");
    const relatedContextSection = renderRelatedContextSection(taskBundle.relatedContext);
    const operatorNoteSection = options?.operatorNote
      ? `## Operator Note\n\nThe operator triggered this revision and left this note. Apply it alongside the existing reviewer findings: do not drop the findings in favor of the note, and do not drop the note in favor of the findings. If the note conflicts with a reviewer finding, surface the conflict in your revision rationale and choose the option that best serves the original issue.\n\n${options.operatorNote}\n`
      : "";
    const vars = { ...taskBundle, plan, planReview, relatedContextSection, operatorNoteSection };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<PlanReviserOutput>(
      AGENT_STAGES.planReviser.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
      },
      "plan-reviser",
      PlanReviserOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "PlanReviserTranscript",
      version: 1,
      payloadJson: {},
      rawText: output.raw,
    });

    const { revision, revisedPlan } = output.parsed.payload;

    await this.artifactRepo.create({
      runId,
      type: "PlanRevision",
      version: 1,
      payloadJson: revision as unknown as object,
      rawText: JSON.stringify(revision, null, 2),
    });

    await this.artifactRepo.create({
      runId,
      type: "Plan",
      version: revisedPlan.planVersion,
      payloadJson: revisedPlan as unknown as object,
      rawText: JSON.stringify(revisedPlan, null, 2),
    });

    const accepted = revision.dispositions.filter((d) => d.status === "accepted").length;
    const dismissed = revision.dispositions.filter((d) => d.status === "dismissed").length;
    const partial = revision.dispositions.filter(
      (d) => d.status === "partially_incorporated",
    ).length;

    this.logger.info(
      {
        runId,
        originalVersion: revision.originalPlanVersion,
        revisedVersion: revision.revisedPlanVersion,
        accepted,
        dismissed,
        partial,
      },
      "Plan revision completed",
    );

    return { revision, revisedPlan };
  }
}
