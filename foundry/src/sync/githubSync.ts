import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";
import type { Finding } from "../schemas/review.js";
import type { ResolutionItem } from "../schemas/remediation.js";
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
  ): Promise<Map<string, number>> {
    const commentMap = new Map<string, number>();

    for (const finding of findings) {
      const body = `**[${finding.severity.toUpperCase()}]** ${finding.title}\n\n${finding.details}`;
      const commentId = await this.githubClient.createPRReviewComment(
        repo,
        prNumber,
        body,
        finding.file,
        finding.lineHint,
      );
      if (commentId) {
        commentMap.set(finding.id, commentId);
      }
    }

    const event = verdict === "approved" ? ("APPROVE" as const) : ("REQUEST_CHANGES" as const);
    const summaryParts = [
      `AI Code Review: ${verdict === "approved" ? "Approved" : "Changes Requested"}`,
      "",
      `${String(findings.length)} finding(s) posted as inline comments.`,
    ];
    await this.githubClient.submitPRReview(repo, prNumber, summaryParts.join("\n"), event);

    this.logger.info(
      { repo, prNumber, findingsCount: findings.length, verdict, mappedComments: commentMap.size },
      "Posted review findings as PR review comments",
    );

    return commentMap;
  }

  async postRemediationResolutions(
    repo: string,
    prNumber: number,
    resolutions: ResolutionItem[],
    commentMap: Record<string, number>,
  ): Promise<void> {
    const statusIcon: Record<string, string> = {
      accepted: ":white_check_mark:",
      rejected: ":no_entry_sign:",
      partially_addressed: ":warning:",
    };

    for (const res of resolutions) {
      const ghCommentId = commentMap[res.findingId];
      if (ghCommentId) {
        const icon = statusIcon[res.status] ?? ":grey_question:";
        const replyBody = [
          `${icon} **${res.status.replace("_", " ")}**`,
          "",
          `**Action:** ${res.action}`,
          `**Rationale:** ${res.rationale}`,
        ].join("\n");

        await this.githubClient.replyToReviewComment(repo, prNumber, ghCommentId, replyBody);
      }
    }

    const rows = resolutions.map((r) => {
      const icon = statusIcon[r.status] ?? ":grey_question:";
      return `| ${icon} **${r.findingId}** | ${r.status.replace("_", " ")} | ${r.action} | ${r.rationale} |`;
    });

    const summaryBody = [
      "## AI Remediation Summary",
      "",
      "| Finding | Status | Action | Rationale |",
      "|---------|--------|--------|-----------|",
      ...rows,
    ].join("\n");

    await this.githubClient.commentOnPR(repo, prNumber, summaryBody);

    this.logger.info(
      {
        repo,
        prNumber,
        resolutionCount: resolutions.length,
        repliedTo: Object.keys(commentMap).length,
      },
      "Posted remediation resolutions to PR",
    );
  }
}
