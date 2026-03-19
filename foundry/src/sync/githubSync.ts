import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";
import type { Finding } from "../schemas/review.js";
import type { GitHubClient } from "../github/githubClient.js";
import type { Logger } from "../utils/logger.js";

export class GitHubSyncService {
  constructor(
    private readonly githubClient: GitHubClient,
    private readonly logger: Logger,
  ) {}

  async syncState(run: Run): Promise<void> {
    if (!run.prNumber) return;

    if (run.state === RunState.ReadyForHumanReview) {
      await this.githubClient.markPRReady(run.repo, run.prNumber);
      await this.githubClient.commentOnPR(
        run.repo,
        run.prNumber,
        "All AI checks passed. Ready for human review.",
      );
      this.logger.debug({ repo: run.repo, prNumber: run.prNumber }, "Marked PR ready for review");
    }
  }

  async postReviewFindings(
    repo: string,
    prNumber: number,
    findings: Finding[],
    verdict: string,
  ): Promise<void> {
    for (const finding of findings) {
      const body = `**[${finding.severity.toUpperCase()}]** ${finding.title}\n\n${finding.details}`;
      await this.githubClient.createPRReviewComment(
        repo,
        prNumber,
        body,
        finding.file,
        finding.lineHint,
      );
    }

    const event = verdict === "approved" ? ("APPROVE" as const) : ("REQUEST_CHANGES" as const);
    const summaryParts = [
      `AI Code Review: ${verdict === "approved" ? "Approved" : "Changes Requested"}`,
      "",
      `${String(findings.length)} finding(s) posted as inline comments.`,
    ];
    await this.githubClient.submitPRReview(repo, prNumber, summaryParts.join("\n"), event);

    this.logger.info(
      { repo, prNumber, findingsCount: findings.length, verdict },
      "Posted review findings as PR review comments",
    );
  }
}
