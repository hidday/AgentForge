import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan, OpenQuestion } from "../schemas/plan.js";
import {
  AnswerResearcherOutputSchema,
  type AnswerResearcherOutput,
} from "../schemas/cliProtocol.js";
import type { ResearchedAnswers } from "../schemas/researchedAnswers.js";
import { AGENT_STAGES } from "../domain/types.js";
import type { HumanAnswer } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { renderRelatedContextSection } from "./sections.js";
import { env } from "../config/env.js";

export interface AnswerResearcherRunOptions {
  /** Prior human-provided answers (so the researcher can skip questions humans already covered). */
  humanAnswers?: HumanAnswer[];
}

export class AnswerResearcherAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(
    plan: Plan,
    taskBundle: TaskBundle,
    runId: string,
    options?: AnswerResearcherRunOptions,
  ): Promise<ResearchedAnswers> {
    this.logger.info(
      {
        runId,
        planVersion: plan.planVersion,
        openQuestionCount: plan.openQuestions.length,
      },
      "Starting answer researcher agent",
    );

    const systemTemplate = loadPromptTemplate("answer-researcher.system.md");
    const userTemplate = loadPromptTemplate("answer-researcher.user.md");

    const relatedContextSection = renderRelatedContextSection(taskBundle.relatedContext);

    const openQuestionsSection = renderOpenQuestionsSection(plan.openQuestions);
    const humanAnswersSection = renderHumanAnswersSection(options?.humanAnswers);

    const vars: Record<string, unknown> = {
      ...taskBundle,
      plan,
      openQuestionsSection,
      humanAnswersSection,
      relatedContextSection,
    };

    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<AnswerResearcherOutput>(
      AGENT_STAGES.answerResearcher.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
      },
      "answer-researcher",
      AnswerResearcherOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "ResearcherTranscript",
      version: 1,
      payloadJson: {},
      rawText: output.raw,
    });

    const researched = output.parsed.payload;

    await this.artifactRepo.create({
      runId,
      type: "ResearchedAnswers",
      version: plan.planVersion,
      payloadJson: researched as unknown as object,
      rawText: JSON.stringify(researched, null, 2),
    });

    const resolvedCount = researched.answers.filter((a) => a.confidence !== "unresolved").length;
    const unresolvedCount = researched.answers.length - resolvedCount;

    this.logger.info(
      {
        runId,
        planVersion: plan.planVersion,
        answeredCount: researched.answers.length,
        resolvedCount,
        unresolvedCount,
      },
      "Answer research completed",
    );

    return researched;
  }
}

function renderOpenQuestionsSection(openQuestions: OpenQuestion[]): string {
  if (openQuestions.length === 0) return "";
  const lines = openQuestions.map(
    (q) => `- **[${q.id}]** ${q.question}${q.requiredForExecution ? " *(blocks execution)*" : ""}`,
  );
  return `## Open Questions to Research\n${lines.join("\n")}`;
}

function renderHumanAnswersSection(humanAnswers?: HumanAnswer[]): string {
  if (!humanAnswers || humanAnswers.length === 0) return "";
  const lines = humanAnswers.map((a) => `- **[${a.questionId}]** ${a.answer}`);
  return (
    `## Prior Human Answers (do NOT re-research these questions)\n${lines.join("\n")}\n\n` +
    `These questions have already been authoritatively answered by a human operator. Skip them and focus your research on the remaining open questions above.`
  );
}
