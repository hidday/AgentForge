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
  ): Promise<PlanRevisionResult> {
    this.logger.info(
      {
        runId,
        planVersion: plan.planVersion,
        reviewId: planReview.reviewId,
        findings: planReview.findings.length,
      },
      "Starting plan reviser agent (Claude CLI, boss mode)",
    );

    const systemTemplate = loadPromptTemplate("plan-reviser.system.md");
    const userTemplate = loadPromptTemplate("plan-reviser.user.md");
    const vars = { ...taskBundle, plan, planReview };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<PlanReviserOutput>(
      AGENT_STAGES.planReviser.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
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
