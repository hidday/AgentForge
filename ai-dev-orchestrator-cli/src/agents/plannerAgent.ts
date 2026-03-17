import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import { PlannerOutputSchema, type PlannerOutput } from "../schemas/cliProtocol.js";
import type { Plan } from "../schemas/plan.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export class PlannerAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(taskBundle: TaskBundle, runId: string): Promise<Plan> {
    this.logger.info({ runId, issueId: taskBundle.issue.id }, "Starting planner agent");

    const systemTemplate = loadPromptTemplate("planner.system.md");
    const userTemplate = loadPromptTemplate("planner.user.md");
    const systemPrompt = renderTemplate(systemTemplate, taskBundle);
    const userPrompt = renderTemplate(userTemplate, taskBundle);

    const output = await this.agentRunner.run<PlannerOutput>(
      AGENT_STAGES.planner.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
      },
      "planner",
      PlannerOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "PlannerTranscript",
      version: 1,
      payloadJson: {},
      rawText: output.raw,
    });

    const plan = output.parsed.payload;

    await this.artifactRepo.create({
      runId,
      type: "Plan",
      version: plan.planVersion,
      payloadJson: plan as unknown as object,
      rawText: JSON.stringify(plan, null, 2),
    });

    this.logger.info(
      { runId, planVersion: plan.planVersion, confidence: plan.confidence, steps: plan.steps.length },
      "Plan created",
    );

    return plan;
  }
}
