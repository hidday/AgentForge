import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";
import type { Finding } from "../schemas/review.js";
import type { ResolutionItem } from "../schemas/remediation.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
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

  /**
   * Post the latest `ExecutionReport` to the PR as a comment so reviewers can
   * see the post-remediation score, summary, and check status without having
   * to open the dashboard. The original PR body is left unchanged (it was
   * written by `createDraftPR` at v1); subsequent versions surface here as
   * appended comments, one per remediation pass.
   */
  async postExecutionReportUpdate(
    repo: string,
    prNumber: number,
    report: ExecutionReport,
  ): Promise<void> {
    const scorePct = (report.score * 100).toFixed(0);
    const checkIcon = (status: string): string =>
      status === "pass" ? ":white_check_mark:" : status === "fail" ? ":x:" : ":heavy_minus_sign:";
    const checkRows = (
      [
        ["Lint", report.checks.lint],
        ["Typecheck", report.checks.typecheck],
        ["Tests", report.checks.tests],
      ] as const
    )
      .map(([label, c]) => `- ${checkIcon(c.status)} **${label}** -- ${c.details}`)
      .join("\n");

    const FILE_COLLAPSE_THRESHOLD = 8;
    const filesSection =
      report.filesChanged.length === 0
        ? ""
        : report.filesChanged.length <= FILE_COLLAPSE_THRESHOLD
          ? [
              "",
              `### Files changed (${report.filesChanged.length})`,
              report.filesChanged.map((f) => `- \`${f}\``).join("\n"),
            ].join("\n")
          : [
              "",
              "<details>",
              `<summary><strong>Files changed (${report.filesChanged.length})</strong></summary>`,
              "",
              report.filesChanged.map((f) => `- \`${f}\``).join("\n"),
              "",
              "</details>",
            ].join("\n");

    const notesSection =
      report.notes.length === 0
        ? ""
        : ["", "### Notes", report.notes.map((n) => `- ${n}`).join("\n")].join("\n");

    const body = [
      `## AI Execution Report (v${report.executionVersion}) -- Score: ${scorePct}%`,
      "",
      `*${report.scoreRationale}*`,
      "",
      report.summary,
      "",
      "### Checks",
      checkRows,
      filesSection,
      notesSection,
    ].join("\n");

    await this.githubClient.commentOnPR(repo, prNumber, body);

    this.logger.info(
      {
        repo,
        prNumber,
        executionVersion: report.executionVersion,
        score: report.score,
        filesChanged: report.filesChanged.length,
      },
      "Posted execution report update to PR",
    );
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
