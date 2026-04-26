import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import { ExecutorOutputSchema, type ExecutorOutput } from "../schemas/cliProtocol.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import { AGENT_STAGES } from "../domain/types.js";
import type { GitHubClient } from "../github/githubClient.js";
import type { GitService } from "../git/gitService.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { env } from "../config/env.js";

export interface ExecutorRetryContext {
  existingBranch?: string | null;
  existingPR?: number | null;
}

export class ExecutorAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly githubClient: GitHubClient,
    private readonly gitService: GitService,
    private readonly logger: Logger,
  ) {}

  async run(
    plan: Plan,
    taskBundle: TaskBundle,
    runId: string,
    retry?: ExecutorRetryContext,
  ): Promise<{ report: ExecutionReport; prNumber: number }> {
    this.logger.info(
      {
        runId,
        planVersion: plan.planVersion,
        isRetry: retry?.existingBranch != null || retry?.existingPR != null,
      },
      "Starting executor agent",
    );

    const systemTemplate = loadPromptTemplate("executor.system.md");
    const userTemplate = loadPromptTemplate("executor.user.md");
    const vars = { ...taskBundle, plan };
    const systemPrompt = renderTemplate(systemTemplate, vars);
    const userPrompt = renderTemplate(userTemplate, vars);

    const output = await this.agentRunner.run<ExecutorOutput>(
      AGENT_STAGES.executor.runtime,
      {
        prompt: userPrompt,
        systemPrompt,
        workingDirectory: taskBundle.repo.repoPath,
        timeoutMs: env.EXECUTOR_TIMEOUT_MS,
        runId,
      },
      "executor",
      ExecutorOutputSchema,
    );

    await this.artifactRepo.create({
      runId,
      type: "ExecutorTranscript",
      version: 2,
      payloadJson: {},
      rawText: output.raw,
    });

    const report = output.parsed.payload;
    const branchName = retry?.existingBranch ?? taskBundle.repo.workingBranch;

    await this.gitService.commitAndPush(
      taskBundle.repo.repoPath,
      branchName,
      `[AI] Implement: ${taskBundle.issue.title}`,
    );

    let prNumber: number;
    if (retry?.existingPR) {
      prNumber = retry.existingPR;
      this.logger.info(
        { runId, prNumber },
        "Skipping PR creation (already exists from previous attempt)",
      );
    } else {
      prNumber = await this.githubClient.createDraftPR(
        taskBundle.repo.name,
        branchName,
        taskBundle.repo.defaultBranch,
        `[AI] ${taskBundle.issue.title}`,
        report.summary,
      );
    }

    await this.artifactRepo.create({
      runId,
      type: "ExecutionReport",
      version: 1,
      payloadJson: report as unknown as object,
      rawText: JSON.stringify(report, null, 2),
    });

    this.logger.info(
      {
        runId,
        filesChanged: report.filesChanged.length,
        prNumber,
        checksPass:
          report.checks.lint.status === "pass" &&
          report.checks.typecheck.status === "pass" &&
          report.checks.tests.status === "pass",
      },
      "Execution completed",
    );

    return { report, prNumber };
  }
}
