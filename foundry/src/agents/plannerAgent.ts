import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import { PlannerOutputSchema, type PlannerOutput } from "../schemas/cliProtocol.js";
import type { Plan } from "../schemas/plan.js";
import { AGENT_STAGES } from "../domain/types.js";
import type { HumanAnswer } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export interface PlannerRunOptions {
  humanAnswers?: HumanAnswer[];
  planVersionOverride?: number;
}

export class PlannerAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(taskBundle: TaskBundle, runId: string, options?: PlannerRunOptions): Promise<Plan> {
    this.logger.info({ runId, issueId: taskBundle.issue.id }, "Starting planner agent");

    const systemTemplate = loadPromptTemplate("planner.system.md");
    const userTemplate = loadPromptTemplate("planner.user.md");
    const systemPrompt = renderTemplate(systemTemplate, taskBundle);

    // Build the humanAnswersSection template variable
    let humanAnswersSection = "";
    if (options?.humanAnswers && options.humanAnswers.length > 0) {
      const answerLines = options.humanAnswers
        .map((a) => `**[${a.questionId}]**: ${a.answer}`)
        .join("\n");
      humanAnswersSection = `## Human Answers to Open Questions\n${answerLines}`;
    }

    const userPrompt = renderTemplate(userTemplate, {
      ...taskBundle,
      humanAnswersSection,
    } as Record<string, unknown>);

    const output = await this.agentRunner.run<PlannerOutput>(
      AGENT_STAGES.planner.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
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

    // Apply planVersionOverride if provided to prevent version collisions
    const effectivePlan =
      options?.planVersionOverride !== undefined
        ? { ...plan, planVersion: options.planVersionOverride }
        : plan;

    await this.artifactRepo.create({
      runId,
      type: "Plan",
      version: effectivePlan.planVersion,
      payloadJson: effectivePlan as unknown as object,
      rawText: JSON.stringify(effectivePlan, null, 2),
    });

    this.logger.info(
      {
        runId,
        planVersion: effectivePlan.planVersion,
        confidence: effectivePlan.confidence,
        steps: effectivePlan.steps.length,
      },
      "Plan created",
    );

    return effectivePlan;
  }
}
