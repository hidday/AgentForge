import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { Review } from "../schemas/review.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import { RemediationOutputSchema, type RemediationOutput } from "../schemas/cliProtocol.js";
import type { Remediation } from "../schemas/remediation.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export class RemediationAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly logger: Logger,
  ) {}

  async run(
    review: Review,
    executionReport: ExecutionReport,
    workingDirectory: string,
    runId: string,
  ): Promise<Remediation> {
    const prevExecutionVersion = executionReport.executionVersion;
    const nextExecutionVersion = prevExecutionVersion + 1;

    this.logger.info(
      {
        runId,
        reviewId: review.reviewId,
        findings: review.findings.length,
        prevExecutionVersion,
        nextExecutionVersion,
      },
      "Starting remediation agent",
    );

    const systemTemplate = loadPromptTemplate("remediation.system.md");
    const userTemplate = loadPromptTemplate("remediation.user.md");
    const executionScoreRubric = loadPromptTemplate("_execution-score-rubric.md");
    const vars = {
      review,
      executionReport,
      executionScoreRubric,
      prevExecutionVersion,
      nextExecutionVersion,
    };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<RemediationOutput>(
      AGENT_STAGES.remediation.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory,
        timeoutMs: env.AGENT_TIMEOUT_MS,
        runId,
      },
      "remediation",
      RemediationOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "RemediationTranscript",
      version: 4,
      payloadJson: {},
      rawText: output.raw,
    });

    const remediation = output.parsed.payload;

    // Server-side override: never trust the model to number its own report.
    // Mirrors how PlannerAgent applies planVersionOverride.
    if (remediation.executionReport.executionVersion !== nextExecutionVersion) {
      this.logger.warn(
        {
          runId,
          modelExecutionVersion: remediation.executionReport.executionVersion,
          expected: nextExecutionVersion,
        },
        "RemediationAgent: model returned wrong executionVersion, overriding server-side",
      );
      remediation.executionReport.executionVersion = nextExecutionVersion;
    }

    const newReport = remediation.executionReport;

    await this.artifactRepo.create({
      runId,
      type: "ExecutionReport",
      version: newReport.executionVersion,
      payloadJson: newReport as unknown as object,
      rawText: JSON.stringify(newReport, null, 2),
    });

    await this.artifactRepo.create({
      runId,
      type: "Remediation",
      version: 1,
      payloadJson: remediation as unknown as object,
      rawText: JSON.stringify(remediation, null, 2),
    });

    const accepted = remediation.resolution.filter((r) => r.status === "accepted").length;
    const rejected = remediation.resolution.filter((r) => r.status === "rejected").length;
    const partial = remediation.resolution.filter((r) => r.status === "partially_addressed").length;
    const scoreDelta = newReport.score - executionReport.score;

    this.logger.info(
      {
        runId,
        reviewId: remediation.reviewId,
        accepted,
        rejected,
        partial,
        readyForHumanReview: remediation.readyForHumanReview,
        prevExecutionVersion,
        newExecutionVersion: newReport.executionVersion,
        prevScore: executionReport.score,
        newScore: newReport.score,
        scoreDelta,
      },
      "Remediation completed",
    );

    return remediation;
  }
}
