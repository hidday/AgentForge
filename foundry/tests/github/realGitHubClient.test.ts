import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOctokit = vi.hoisted(() => ({
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
  Octokit: vi.fn(() => mockOctokit),
}));

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeHttpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeMockLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeMockLogger();
    client = new RealGitHubClient("fake-token", logger as never);
  });

  describe("constructor / splitRepo", () => {
    it("constructs an Octokit instance with the given auth token", async () => {
      const { Octokit } = await import("@octokit/rest");
      expect(Octokit).toHaveBeenCalledWith({ auth: "fake-token" });
    });

    it("throws a descriptive error for a malformed repo string", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      mockOctokit.repos.get.mockResolvedValueOnce({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("throws a meaningful error when the API call fails", async () => {
      mockOctokit.repos.get.mockRejectedValueOnce(new Error("not found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*not found/,
      );
    });

    it("stringifies a non-Error rejection in the thrown message", async () => {
      mockOctokit.repos.get.mockRejectedValueOnce("timeout string");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*timeout string/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      mockOctokit.repos.get.mockResolvedValueOnce({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
    });

    it("throws a wrapped error when the API call fails", async () => {
      mockOctokit.repos.get.mockRejectedValueOnce(new Error("boom"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha on success", async () => {
      mockOctokit.repos.get.mockResolvedValueOnce({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValueOnce({ data: { object: { sha: "sha-123" } } });
      mockOctokit.git.createRef.mockResolvedValueOnce({});

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/feature/x",
        sha: "sha-123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      mockOctokit.repos.get.mockResolvedValueOnce({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValueOnce({ data: { object: { sha: "sha-123" } } });
      mockOctokit.git.createRef.mockRejectedValueOnce(makeHttpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("throws a wrapped error for a non-422 failure", async () => {
      mockOctokit.repos.get.mockRejectedValueOnce(makeHttpError(500, "server error"));

      await expect(client.createBranch("acme/widgets", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number on success", async () => {
      mockOctokit.pulls.create.mockResolvedValueOnce({ data: { number: 42 } });

      const result = await client.createDraftPR(
        "acme/widgets",
        "feature/x",
        "main",
        "My title",
        "My body",
      );

      expect(result).toBe(42);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "feature/x",
        base: "main",
        title: "My title",
        body: "My body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure", async () => {
      mockOctokit.pulls.create.mockRejectedValueOnce(
        makeHttpError(422, 'Validation failed: {"code":"invalid"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a 422 duplicate-head failure", async () => {
      mockOctokit.pulls.create.mockRejectedValueOnce(makeHttpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValueOnce({ data: [{ number: 77 }] });

      const result = await client.createDraftPR(
        "acme/widgets",
        "feature/x",
        "main",
        "T",
        "B",
      );

      expect(result).toBe(77);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:feature/x",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error when the 422 duplicate-head lookup finds no existing PR", async () => {
      mockOctokit.pulls.create.mockRejectedValueOnce(makeHttpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValueOnce({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
    });

    it("throws a wrapped error for a non-422 failure", async () => {
      mockOctokit.pulls.create.mockRejectedValueOnce(makeHttpError(500, "server error"));

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets".*server error/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on success", async () => {
      mockOctokit.issues.createComment.mockResolvedValueOnce({});

      await expect(client.commentOnPR("acme/widgets", 10, "hello")).resolves.toBeUndefined();

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 10,
        body: "hello",
      });
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.issues.createComment.mockRejectedValueOnce(new Error("rate limited"));

      await expect(client.commentOnPR("acme/widgets", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets".*rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: "diff --git a/x b/x\n+added" });

      const result = await client.getPRDiff("acme/widgets", 10);

      expect(result).toBe("diff --git a/x b/x\n+added");
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValueOnce(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 10)).rejects.toThrow(
        /GitHub getPRDiff failed for "acme\/widgets".*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via the GraphQL mutation", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { draft: true, node_id: "PR_node_1" } });
      mockOctokit.graphql.mockResolvedValueOnce({});

      await expect(client.markPRReady("acme/widgets", 10)).resolves.toBeUndefined();

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_node_1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10 },
        "Marked PR as ready for review",
      );
    });

    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { draft: false, node_id: "PR_node_1" } });

      await expect(client.markPRReady("acme/widgets", 10)).resolves.toBeUndefined();

      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValueOnce(new Error("boom"));

      await expect(client.markPRReady("acme/widgets", 10)).rejects.toThrow(
        /GitHub markPRReady failed for "acme\/widgets".*boom/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps the API response into PRComment[], defaulting missing fields", async () => {
      mockOctokit.issues.listComments.mockResolvedValueOnce({
        data: [
          { id: 1, user: { login: "alice" }, body: "nice work", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const result = await client.listPRComments("acme/widgets", 10);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "nice work", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.issues.listComments.mockRejectedValueOnce(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 10)).rejects.toThrow(
        /GitHub listPRComments failed for "acme\/widgets".*boom/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a file-level comment when no line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { head: { sha: "commit-1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValueOnce({ data: { id: 500 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "Looks off",
        "src/a.ts",
      );

      expect(result).toBe(500);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "Looks off",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-1",
      });
    });

    it("creates a line-level comment when a line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { head: { sha: "commit-1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValueOnce({ data: { id: 501 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "Fix this line",
        "src/a.ts",
        12,
      );

      expect(result).toBe(501);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "Fix this line",
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "commit-1",
      });
    });

    it("falls back to a file-level comment when the line-level request 422s", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { head: { sha: "commit-1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(makeHttpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "Fix this line",
        "src/a.ts",
        12,
      );

      expect(result).toBe(502);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "*(line 12)* Fix this line",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10, path: "src/a.ts", line: 12 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("throws a wrapped error when the line-level request fails with a non-422 status", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce({ data: { head: { sha: "commit-1" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(makeHttpError(500, "server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "Fix this line", "src/a.ts", 12),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*server error/);
    });

    it("returns 0 and logs a warning when the overall request 422s (e.g. file not in diff)", async () => {
      mockOctokit.pulls.get.mockRejectedValueOnce(makeHttpError(422, "file not in diff"));

      const result = await client.createPRReviewComment("acme/widgets", 10, "x", "src/missing.ts");

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10, path: "src/missing.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("throws a wrapped error for a non-422 failure fetching the PR", async () => {
      mockOctokit.pulls.get.mockRejectedValueOnce(makeHttpError(500, "server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "x", "src/missing.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*server error/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValueOnce({});

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 500, "thanks"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        comment_id: 500,
        body: "thanks",
      });
    });

    it("swallows the error and logs a warning instead of throwing on failure", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValueOnce(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 500, "thanks"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10, commentId: 500, error: "comment gone" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review on success", async () => {
      mockOctokit.pulls.createReview.mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("acme/widgets", 10, "LGTM", "APPROVE"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because it's the author's own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("acme/widgets", 10, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("throws a wrapped error for a non-own-PR failure", async () => {
      mockOctokit.pulls.createReview.mockRejectedValueOnce(new Error("server error"));

      await expect(
        client.submitPRReview("acme/widgets", 10, "needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets".*server error/);
    });

    it("throws a wrapped error when the event is already COMMENT and the call fails", async () => {
      mockOctokit.pulls.createReview.mockRejectedValueOnce(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 10, "needs work", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets"/);
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
