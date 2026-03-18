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

  async createBranch(repo: string, branchName: string): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

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
  }

  async createDraftPR(
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<number> {
    const { owner, repo: repoName } = splitRepo(repo);

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
  }

  async commentOnPR(repo: string, prNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    await this.octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body,
    });

    this.logger.debug({ repo, prNumber }, "Commented on PR");
  }

  async getPRDiff(repo: string, prNumber: number): Promise<string> {
    const { owner, repo: repoName } = splitRepo(repo);

    const { data } = await this.octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    return data as unknown as string;
  }

  async markPRReady(repo: string, prNumber: number): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

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
  }

  async listPRComments(repo: string, prNumber: number): Promise<PRComment[]> {
    const { owner, repo: repoName } = splitRepo(repo);

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
  }

  async createPRReviewComment(
    repo: string,
    prNumber: number,
    body: string,
    path: string,
    line?: number,
  ): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    const commitId = pr.head.sha;

    if (line != null) {
      await this.octokit.pulls.createReviewComment({
        owner,
        repo: repoName,
        pull_number: prNumber,
        body,
        path,
        line,
        side: "RIGHT",
        commit_id: commitId,
      });
    } else {
      await this.octokit.pulls.createReviewComment({
        owner,
        repo: repoName,
        pull_number: prNumber,
        body,
        path,
        subject_type: "file",
        commit_id: commitId,
      });
    }

    this.logger.debug({ repo, prNumber, path, line }, "Created PR review comment");
  }

  async submitPRReview(
    repo: string,
    prNumber: number,
    body: string,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  ): Promise<void> {
    const { owner, repo: repoName } = splitRepo(repo);

    await this.octokit.pulls.createReview({
      owner,
      repo: repoName,
      pull_number: prNumber,
      body,
      event,
    });

    this.logger.debug({ repo, prNumber, event }, "Submitted PR review");
  }
}
