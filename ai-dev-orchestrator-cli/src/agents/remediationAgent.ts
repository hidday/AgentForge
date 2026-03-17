import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { Review } from "../schemas/review.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import {
  RemediationOutputSchema,
  type RemediationOutput,
} from "../schemas/cliProtocol.js";
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
    this.logger.info(
      { runId, reviewId: review.reviewId, findings: review.findings.length },
      "Starting remediation agent",
    );

    const systemTemplate = loadPromptTemplate("remediation.system.md");
    const userTemplate = loadPromptTemplate("remediation.user.md");
    const vars = { review, executionReport };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<RemediationOutput>(
      AGENT_STAGES.remediation.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory,
        timeoutMs: env.AGENT_TIMEOUT_MS,
      },
      "remediation",
      RemediationOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "RawTranscript",
      version: 4,
      payloadJson: {},
      rawText: output.raw,
    });

    const remediation = output.parsed.payload;

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

    this.logger.info(
      {
        runId,
        reviewId: remediation.reviewId,
        accepted,
        rejected,
        partial,
        readyForHumanReview: remediation.readyForHumanReview,
      },
      "Remediation completed",
    );

    return remediation;
  }
}
