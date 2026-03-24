import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import { ReviewerOutputSchema, type ReviewerOutput } from "../schemas/cliProtocol.js";
import type { Review } from "../schemas/review.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export class ReviewerAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(
    plan: Plan,
    executionReport: ExecutionReport,
    diff: string,
    taskBundle: TaskBundle,
    runId: string,
  ): Promise<Review> {
    this.logger.info({ runId }, "Starting reviewer agent (Codex CLI)");

    const systemTemplate = loadPromptTemplate("reviewer.system.md");
    const userTemplate = loadPromptTemplate("reviewer.user.md");
    const vars = { ...taskBundle, plan, executionReport, diff };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<ReviewerOutput>(
      AGENT_STAGES.reviewer.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
      },
      "reviewer",
      ReviewerOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: output.raw,
    });

    const review = output.parsed.payload;

    await this.artifactRepo.create({
      runId,
      type: "Review",
      version: 1,
      payloadJson: review as unknown as object,
      rawText: JSON.stringify(review, null, 2),
    });

    const blockerCount = review.findings.filter((f) => f.severity === "blocker").length;
    const importantCount = review.findings.filter((f) => f.severity === "important").length;

    this.logger.info(
      {
        runId,
        reviewId: review.reviewId,
        verdict: review.overallVerdict,
        totalFindings: review.findings.length,
        blockerCount,
        importantCount,
      },
      "Review completed",
    );

    return review;
  }
}
