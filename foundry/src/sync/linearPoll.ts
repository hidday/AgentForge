import type { LinearClient, LinearIssue } from "../linear/linearClient.js";
import type { RunRepository } from "../orchestrator/runRepository.js";
import type { OrchestratorService } from "../orchestrator/orchestratorService.js";
import type { RepoRegistry } from "../config/repoRegistry.js";
import type { Logger } from "../utils/logger.js";

const DEFAULT_POLL_STATE = "Todo";

export class LinearPollService {
  constructor(
    private readonly linearClient: LinearClient,
    private readonly runRepo: RunRepository,
    private readonly orchestrator: OrchestratorService,
    private readonly repoRegistry: RepoRegistry,
    private readonly logger: Logger,
  ) {}

  async discoverPendingIssues(): Promise<LinearIssue[]> {
    const repos = this.repoRegistry.listRepos();
    const projects = repos
      .map((r) => r.linearProject)
      .filter((p): p is string => p != null);

    if (projects.length === 0) {
      this.logger.warn("No Linear projects configured in repo registry");
      return [];
    }

    const allCandidates: LinearIssue[] = [];

    for (const project of projects) {
      const issues = await this.linearClient.searchIssues(project, DEFAULT_POLL_STATE);

      for (const issue of issues) {
        const existingRun = await this.runRepo.findActiveByIssueId(issue.id);
        if (!existingRun) {
          allCandidates.push(issue);
        }
      }
    }

    this.logger.info(
      { candidateCount: allCandidates.length, projects },
      "Discovered pending Linear issues",
    );

    return allCandidates;
  }

  async startRunsForIssues(
    issueIds: string[],
  ): Promise<{ started: string[]; skipped: string[] }> {
    const started: string[] = [];
    const skipped: string[] = [];

    for (const issueId of issueIds) {
      try {
        const existingRun = await this.runRepo.findActiveByIssueId(issueId);
        if (existingRun) {
          skipped.push(issueId);
          continue;
        }

        await this.orchestrator.startRun(issueId);
        started.push(issueId);
      } catch (err) {
        this.logger.error(
          { issueId, error: err instanceof Error ? err.message : String(err) },
          "Failed to start run for issue",
        );
        skipped.push(issueId);
      }
    }

    this.logger.info(
      { started: started.length, skipped: skipped.length },
      "Ingested Linear issues",
    );

    return { started, skipped };
  }
}
