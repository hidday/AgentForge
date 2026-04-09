import type { LinearClient, LinearIssue, IssueSearchFilter } from "../linear/linearClient.js";
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

    // Build one search filter per repo entry. A repo is included if it has
    // either a linearProject name or assigneeMe=true configured.
    const filters: IssueSearchFilter[] = repos
      .filter((r) => r.linearProject != null || r.assigneeMe === true)
      .map((r) => ({
        projectName: r.linearProject,
        assigneeMe: r.assigneeMe,
        team: r.linearTeam,
        state: DEFAULT_POLL_STATE,
      }));

    if (filters.length === 0) {
      this.logger.warn("No Linear projects or assigneeMe repos configured in repo registry");
      return [];
    }

    const seenIds = new Set<string>();
    const allCandidates: LinearIssue[] = [];

    for (const filter of filters) {
      const issues = await this.linearClient.searchIssues(filter);

      for (const issue of issues) {
        if (seenIds.has(issue.id)) continue;
        seenIds.add(issue.id);

        const existingRun = await this.runRepo.findActiveByIssueId(issue.id);
        if (!existingRun) {
          allCandidates.push(issue);
        }
      }
    }

    this.logger.info(
      {
        candidateCount: allCandidates.length,
        filters: filters.map((f) => ({
          project: f.projectName,
          assigneeMe: f.assigneeMe,
          team: f.team,
        })),
      },
      "Discovered pending Linear issues",
    );

    return allCandidates;
  }

  async startRunsForIssues(issueIds: string[]): Promise<{ started: string[]; skipped: string[] }> {
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
