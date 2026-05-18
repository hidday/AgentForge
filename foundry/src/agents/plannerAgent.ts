import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import { PlannerOutputSchema, type PlannerOutput } from "../schemas/cliProtocol.js";
import type { Plan } from "../schemas/plan.js";
import { AGENT_STAGES } from "../domain/types.js";
import type { HumanAnswer, SkillDocument } from "../domain/types.js";
import type { ResearchedAnswer } from "../schemas/researchedAnswers.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { renderRelatedContextSection } from "./sections.js";
import { env } from "../config/env.js";

export interface PlanReviewFindingSummary {
  id: string;
  severity: string;
  title: string;
  details: string;
}

export interface PlannerRunOptions {
  humanAnswers?: HumanAnswer[];
  researchedAnswers?: ResearchedAnswer[];
  planVersionOverride?: number;
  humanFeedback?: { planVersion: number; feedback: string };
  planReviewFindings?: { summary: string; findings: PlanReviewFindingSummary[] };
  previousPlan?: Plan;
  priorSkills?: SkillDocument[];
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

    // Build the researchedAnswersSection template variable
    let researchedAnswersSection = "";
    if (options?.researchedAnswers && options.researchedAnswers.length > 0) {
      const answerLines = options.researchedAnswers
        .map(
          (a) =>
            `**[${a.questionId}] (confidence: ${a.confidence})**: ${a.answer}` +
            (a.sources && a.sources.length > 0 ? `\n  - sources: ${a.sources.join(", ")}` : ""),
        )
        .join("\n");
      researchedAnswersSection =
        `## Researched Answers to Open Questions (AI best-effort, not authoritative)\n` +
        `${answerLines}\n\n` +
        `Treat these as confident-but-not-authoritative context. Human answers (if any) override them. ` +
        `Any question still marked \`unresolved\` or only \`low\` confidence should remain in the new plan's \`openQuestions\` so a human can weigh in.`;
    }

    // Build the humanFeedbackSection template variable
    let humanFeedbackSection = "";
    if (options?.humanFeedback) {
      const { planVersion, feedback } = options.humanFeedback;
      humanFeedbackSection =
        `## Human Feedback on Previous Plan\n` +
        `**Rejected Plan Version:** V${planVersion}\n\n` +
        `${feedback}\n\n` +
        `Address this feedback directly in the new plan while preserving the valid parts of the previous approach.`;
    }

    // Build the planReviewSection template variable
    let planReviewSection = "";
    if (options?.planReviewFindings) {
      const { summary, findings } = options.planReviewFindings;
      const findingLines = findings
        .map((f) => `- **[${f.severity}] ${f.title}** (${f.id}): ${f.details}`)
        .join("\n");
      planReviewSection =
        `## AI Plan Review Findings (from previous plan)\n` +
        `**Review Summary:** ${summary}\n\n` +
        `${findingLines}\n\n` +
        `Incorporate these findings into the revised plan where appropriate.`;
    }

    // Build the previousPlanSection so the re-planner can see what was rejected
    let previousPlanSection = "";
    if (options?.previousPlan) {
      const p = options.previousPlan;
      const stepsText = p.steps
        .map((s, i) => `${i + 1}. **${s.title}** (${s.id}): ${s.description}`)
        .join("\n");
      const risksText =
        p.risks.length > 0 ? `\n**Risks:**\n${p.risks.map((r) => `- ${r}`).join("\n")}` : "";
      const assumptionsText =
        p.assumptions.length > 0
          ? `\n**Assumptions:**\n${p.assumptions.map((a) => `- ${a}`).join("\n")}`
          : "";
      const questionLines = p.openQuestions
        .map(
          (q) =>
            `- [${q.id}] ${q.question}${q.requiredForExecution ? " *(blocks execution)*" : ""}`,
        )
        .join("\n");
      const questionsText =
        p.openQuestions.length > 0 ? `\n**Open Questions:**\n${questionLines}` : "";

      previousPlanSection =
        `## Previously Rejected Plan (v${p.planVersion})\n` +
        `**Summary:** ${p.summary}\n` +
        `**Confidence:** ${(p.confidence * 100).toFixed(0)}%\n\n` +
        `**Steps:**\n${stepsText}` +
        `${assumptionsText}${risksText}${questionsText}\n\n` +
        `**Test Plan:** ${p.testPlan}\n\n` +
        `Use this as the starting point for the new plan. Preserve the parts that are still valid and address the issues raised in the rejection feedback and review findings.`;
    }

    const relatedContextSection = renderRelatedContextSection(taskBundle.relatedContext);

    // Build priorSkillsSection
    let priorSkillsSection = "";
    if (options?.priorSkills && options.priorSkills.length > 0) {
      const skillBlocks = options.priorSkills
        .map((skill) => `### ${skill.taskCategory}\n\n${skill.skillMarkdown}`)
        .join("\n\n");
      priorSkillsSection = `## Prior Skills from Similar Tasks\n\n${skillBlocks}`;
    }

    const userPrompt = renderTemplate(userTemplate, {
      ...taskBundle,
      humanAnswersSection,
      researchedAnswersSection,
      humanFeedbackSection,
      planReviewSection,
      previousPlanSection,
      relatedContextSection,
      priorSkillsSection,
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
