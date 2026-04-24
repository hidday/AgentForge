import { Octokit } from "@octokit/rest";
import type { GitHubClient, PRComment } from "./githubClient.js";
import type { Logger } from "../utils/logger.js";

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo format "${fullName}", expected "owner/repo"`);
  }
  return { owner, repo };
}

export class RealGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;
  private readonly logger: Logger;

  constructor(token: string, logger: Logger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = logger;
  }

  async verifyRepoAccess(repo: string): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);
    try {
      await this.octokit.repos.get({ owner, repo: repoName });
      this.logger.debug({ repo }, "Verified GitHub repo access");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `GitHub: cannot access repo "${repo}". Check that GITHUB_TOKEN has repository access permissions. Original: ${detail}`,
        { cause: err },
      );
    }
  }

  private wrapError(
    operation: string,
    repo: string,
    err: unknown,
    extra?: Record<string, unknown>,
  ): Error {
    const detail = err instanceof Error ? err.message : String(err);
    const context = extra ? ` ${JSON.stringify(extra)}` : "";
    return new Error(`GitHub ${operation} failed for "${repo}"${context}: ${detail}`);
  }

  async getDefaultBranch(repo: string): Promise<string> {
    const { owner, repo: repoName } = splitRepo(repo);
    try {
      const { data } = await this.octokit.repos.get({ owner, repo: repoName });
      return data.default_branch;
    } catch (err) {
      throw this.wrapError("getDefaultBranch", repo, err);
    }
  }

  async createBranch(repo: string, branchName: string): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data: repoData } = await this.octokit.repos.get({
        owner,
        repo: repoName,
      });
      const defaultBranch = repoData.default_branch;

      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${defaultBranch}`,
      });

      await this.octokit.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      });

      this.logger.debug({ repo, branchName }, "Created branch on GitHub");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) {
        this.logger.info({ repo, branchName }, "Branch already exists on GitHub, continuing");
        return;
      }
      throw this.wrapError("createBranch", repo, err, { branchName });
    }
  }

  async createDraftPR(
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<number> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo: repoName,
        head,
        base,
        title,
        body,
        draft: true,
      });

      this.logger.debug({ repo, prNumber: data.number }, "Created draft PR on GitHub");
      return data.number;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) {
        const message = err instanceof Error ? err.message : String(err);
        const isFieldValidation =
          message.includes('"code":"invalid"') || message.includes('"code":"missing_field"');

        if (isFieldValidation) {
          this.logger.error(
            { repo, head, base, detail: message },
            "PR creation failed: invalid field (base branch may not exist)",
          );
          throw this.wrapError("createDraftPR", repo, err, { head, base });
        }

        this.logger.info(
          { repo, head, base },
          "PR already exists for this head branch, looking up existing PR",
        );
        const { data: pulls } = await this.octokit.pulls.list({
          owner,
          repo: repoName,
          head: `${owner}:${head}`,
          base,
          state: "open",
        });
        const existing = pulls[0];
        if (existing) {
          this.logger.info({ repo, prNumber: existing.number }, "Found existing open PR");
          return existing.number;
        }
      }
      throw this.wrapError("createDraftPR", repo, err, { head, base });
    }
  }

  async commentOnPR(repo: string, prNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      await this.octokit.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body,
      });

      this.logger.debug({ repo, prNumber }, "Commented on PR");
    } catch (err) {
      throw this.wrapError("commentOnPR", repo, err, { prNumber });
    }
  }

  async getPRDiff(repo: string, prNumber: number): Promise<string> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data } = await this.octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });

      return data as unknown as string;
    } catch (err) {
      throw this.wrapError("getPRDiff", repo, err, { prNumber });
    }
  }

  async markPRReady(repo: string, prNumber: number): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

      if (!pr.draft) return;

      await this.octokit.graphql(
        `mutation($prId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
            pullRequest { id }
          }
        }`,
        { prId: pr.node_id },
      );

      this.logger.debug({ repo, prNumber }, "Marked PR as ready for review");
    } catch (err) {
      throw this.wrapError("markPRReady", repo, err, { prNumber });
    }
  }

  async listPRComments(repo: string, prNumber: number): Promise<PRComment[]> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data } = await this.octokit.issues.listComments({
        owner,
        repo: repoName,
        issue_number: prNumber,
      });

      return data.map((c) => ({
        id: String(c.id),
        author: c.user?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.created_at,
      }));
    } catch (err) {
      throw this.wrapError("listPRComments", repo, err, { prNumber });
    }
  }

  async createPRReviewComment(
    repo: string,
    prNumber: number,
    body: string,
    path: string,
    line?: number,
  ): Promise<number> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

      const commitId = pr.head.sha;
      let commentId: number;

      if (line != null) {
        try {
          const { data } = await this.octokit.pulls.createReviewComment({
            owner,
            repo: repoName,
            pull_number: prNumber,
            body,
            path,
            line,
            side: "RIGHT",
            commit_id: commitId,
          });
          commentId = data.id;
        } catch (lineErr) {
          const status = (lineErr as { status?: number }).status;
          if (status === 422) {
            this.logger.warn(
              { repo, prNumber, path, line },
              "Line not in PR diff, falling back to file-level comment",
            );
            const { data } = await this.octokit.pulls.createReviewComment({
              owner,
              repo: repoName,
              pull_number: prNumber,
              body: `*(line ${String(line)})* ${body}`,
              path,
              subject_type: "file",
              commit_id: commitId,
            });
            commentId = data.id;
          } else {
            throw lineErr;
          }
        }
      } else {
        const { data } = await this.octokit.pulls.createReviewComment({
          owner,
          repo: repoName,
          pull_number: prNumber,
          body,
          path,
          subject_type: "file",
          commit_id: commitId,
        });
        commentId = data.id;
      }

      this.logger.debug({ repo, prNumber, path, line, commentId }, "Created PR review comment");
      return commentId;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) {
        this.logger.warn(
          { repo, prNumber, path, line },
          "Could not post PR review comment (file may not be in diff), skipping",
        );
        return 0;
      }
      throw this.wrapError("createPRReviewComment", repo, err, { prNumber, path, line });
    }
  }

  async replyToReviewComment(
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      await this.octokit.pulls.createReplyForReviewComment({
        owner,
        repo: repoName,
        pull_number: prNumber,
        comment_id: commentId,
        body,
      });

      this.logger.debug({ repo, prNumber, commentId }, "Replied to PR review comment");
    } catch (err) {
      this.logger.warn(
        { repo, prNumber, commentId, error: err instanceof Error ? err.message : String(err) },
        "Failed to reply to PR review comment, skipping",
      );
    }
  }

  async submitPRReview(
    repo: string,
    prNumber: number,
    body: string,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  ): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    try {
      await this.octokit.pulls.createReview({
        owner,
        repo: repoName,
        pull_number: prNumber,
        body,
        event,
      });

      this.logger.debug({ repo, prNumber, event }, "Submitted PR review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (event !== "COMMENT" && /can\s*not.*request changes.*own/i.test(msg)) {
        this.logger.info(
          { repo, prNumber, originalEvent: event },
          "Cannot request changes on own PR, falling back to COMMENT",
        );
        await this.octokit.pulls.createReview({
          owner,
          repo: repoName,
          pull_number: prNumber,
          body,
          event: "COMMENT",
        });
        return;
      }
      throw this.wrapError("submitPRReview", repo, err, { prNumber, event });
    }
  }
}
