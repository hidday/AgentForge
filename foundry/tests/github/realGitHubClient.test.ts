import { describe, it, expect, vi, beforeEach } from "vitest";

const octokit = vi.hoisted(() => ({
  repos: { get: vi.fn() },
  git: { getRef: vi.fn(), createRef: vi.fn() },
  pulls: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    createReviewComment: vi.fn(),
    createReplyForReviewComment: vi.fn(),
    createReview: vi.fn(),
  },
  issues: { createComment: vi.fn(), listComments: vi.fn() },
  graphql: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => octokit),
}));

const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function httpError(status: number, message = "GitHub API error") {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("repo name parsing", () => {
    it("rejects a repo string with no slash", async () => {
      const client = new RealGitHubClient("token", makeLogger() as never);
      await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("wraps the error with guidance when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
    });

    it("wraps a failure with operation context", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo": boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's HEAD sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.createBranch("org/repo", "ai/lin-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({ owner: "org", repo: "repo", ref: "heads/main" });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/lin-1",
        sha: "sha123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(422));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      await expect(client.createBranch("org/repo", "ai/lin-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "ai/lin-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 failure", async () => {
      octokit.repos.get.mockRejectedValue(httpError(500, "server error"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createBranch("org/repo", "ai/lin-1")).rejects.toThrow(
        /GitHub createBranch failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(num).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ owner: "org", repo: "repo", head: "head", base: "main", draft: true }),
      );
    });

    it("throws a wrapped error on 422 with an invalid-field validation message", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, '{"code":"invalid","field":"base"}'));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("falls back to the existing open PR for the head branch on a plain 422", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const num = await client.createDraftPR("org/repo", "head", "main", "T", "B");

      expect(num).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("re-throws when a 422 occurs but no existing PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("wraps a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /network down/,
      );
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.commentOnPR("org/repo", 7, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 7,
        body: "hello",
      });
    });

    it("wraps a failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.commentOnPR("org/repo", 7, "hello")).rejects.toThrow(/rate limited/);
    });
  });

  describe("getPRDiff", () => {
    it("fetches the diff via the diff media type", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const diff = await client.getPRDiff("org/repo", 7);

      expect(diff).toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: { format: "diff" } }),
      );
    });

    it("wraps a failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getPRDiff("org/repo", 7)).rejects.toThrow(/not found/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node1" } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.markPRReady("org/repo", 7);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node1" } });
      octokit.graphql.mockResolvedValue({});
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.markPRReady("org/repo", 7);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node1",
      });
    });

    it("wraps a failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.markPRReady("org/repo", 7)).rejects.toThrow(/boom/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments to the PRComment shape, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const comments = await client.listPRComments("org/repo", 7);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps a failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.listPRComments("org/repo", 7)).rejects.toThrow(/boom/);
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const id = await client.createPRReviewComment("org/repo", 7, "body", "src/a.ts", 10);

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src/a.ts", line: 10, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 502 } });
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      const id = await client.createPRReviewComment("org/repo", 7, "body", "src/a.ts", 10);

      expect(id).toBe(502);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 7, path: "src/a.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
      const secondCallArgs = octokit.pulls.createReviewComment.mock.calls[1][0];
      expect(secondCallArgs.subject_type).toBe("file");
      expect(secondCallArgs.body).toContain("(line 10)");
    });

    it("rethrows a non-422 error from the line-level attempt", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValueOnce(new Error("network error"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createPRReviewComment("org/repo", 7, "body", "src/a.ts", 10)).rejects.toThrow(
        /network error/,
      );
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 503 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const id = await client.createPRReviewComment("org/repo", 7, "body", "src/a.ts");

      expect(id).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file" }),
      );
    });

    it("returns 0 and warns when the whole operation 422s (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      const id = await client.createPRReviewComment("org/repo", 7, "body", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 7, path: "src/a.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 failure from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createPRReviewComment("org/repo", 7, "body", "src/a.ts")).rejects.toThrow(
        /boom/,
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to a review comment", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.replyToReviewComment("org/repo", 7, 501, "ack");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        comment_id: 501,
        body: "ack",
      });
    });

    it("swallows a failure and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      await expect(client.replyToReviewComment("org/repo", 7, 501, "ack")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "org/repo", prNumber: 7, commentId: 501, error: "gone" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.submitPRReview("org/repo", 7, "looks good", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ body: "looks good", event: "APPROVE" }),
      );
    });

    it("falls back to COMMENT when requesting changes on the author's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      await client.submitPRReview("org/repo", 7, "body", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ event: "COMMENT" }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 7, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("wraps any other failure", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.submitPRReview("org/repo", 7, "body", "APPROVE")).rejects.toThrow(/boom/);
    });

    it("does not retry the own-PR fallback when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.submitPRReview("org/repo", 7, "body", "COMMENT")).rejects.toThrow();
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
