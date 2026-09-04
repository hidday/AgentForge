import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

const octokitMock = {
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
};

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => octokitMock),
}));

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function statusError(status: number, message = "octokit error"): Error {
  const err = new Error(message);
  (err as unknown as { status: number }).status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
  });

  describe("repo splitting", () => {
    it("rejects with a clear message when the repo is not in owner/repo form", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokitMock.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalledWith({ repo: "org/repo" }, "Verified GitHub repo access");
    });

    it("wraps the error with guidance when access fails", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*GITHUB_TOKEN.*Original: Not Found/s,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo": boom',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokitMock.git.createRef.mockResolvedValue({});

      await client.createBranch("org/repo", "ai/issue-1");

      expect(octokitMock.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokitMock.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/issue-1",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "ai/issue-1" },
        "Created branch on GitHub",
      );
    });

    it("treats a 422 (branch already exists) as success and logs info", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokitMock.git.createRef.mockRejectedValue(statusError(422));

      await expect(client.createBranch("org/repo", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "ai/issue-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps other errors", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("org/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo".*network error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokitMock.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(42);
      expect(octokitMock.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error for 422 field validation failures", async () => {
      const err = statusError(422, '{"code":"invalid","field":"base"}');
      octokitMock.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns the existing open PR on a non-field 422", async () => {
      octokitMock.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(55);
      expect(octokitMock.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error when a 422 occurs but no existing PR is found", async () => {
      octokitMock.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
    });

    it("throws a wrapped error for non-422 failures", async () => {
      octokitMock.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo".*server error/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokitMock.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("org/repo", 10, "hello");

      expect(octokitMock.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokitMock.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("org/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "org\/repo".*rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("org/repo", 10)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed for "org\/repo".*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_id123" } });
      octokitMock.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 10);

      expect(octokitMock.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "PR_id123" },
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10 },
        "Marked PR as ready for review",
      );
    });

    it("does nothing when the PR is already not a draft", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_id123" } });

      await client.markPRReady("org/repo", 10);

      expect(octokitMock.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("org/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed for "org\/repo".*gone/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, falling back to 'unknown' author and empty body", async () => {
      octokitMock.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokitMock.issues.listComments.mockRejectedValue(new Error("forbidden"));

      await expect(client.listPRComments("org/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed for "org\/repo".*forbidden/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 777 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/x.ts", 5);

      expect(id).toBe(777);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/x.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422))
        .mockResolvedValueOnce({ data: { id: 888 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/x.ts", 5);

      expect(id).toBe(888);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* body",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, path: "src/x.ts", line: 5 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("creates a file-level comment when no line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 999 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/x.ts");

      expect(id).toBe(999);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning on a non-line-specific 422", async () => {
      octokitMock.pulls.get.mockRejectedValue(statusError(422));

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/x.ts", 5);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, path: "src/x.ts", line: 5 },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps non-422 errors from the line-comment attempt", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockRejectedValue(statusError(500, "server error"));

      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/x.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo".*server error/);
    });

    it("wraps non-422 errors when fetching the PR fails", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("unreachable"));

      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/x.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo".*unreachable/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply and logs debug on success", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("org/repo", 10, 555, "reply body");

      expect(octokitMock.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        comment_id: 555,
        body: "reply body",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, commentId: 555 },
        "Replied to PR review comment",
      );
    });

    it("swallows errors, logging a warning instead of throwing", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("org/repo", 10, 555, "reply body"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, commentId: 555, error: "comment deleted" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review and logs debug on success", async () => {
      octokitMock.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("org/repo", 10, "lgtm", "APPROVE");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on one's own PR", async () => {
      octokitMock.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("org/repo", 10, "body", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokitMock.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("does not retry (and wraps the error) when the event was already COMMENT", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("org/repo", 10, "body", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed for "org\/repo"/,
      );
      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps other errors without retrying", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(new Error("validation failed"));

      await expect(
        client.submitPRReview("org/repo", 10, "body", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "org\/repo".*validation failed/);
      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
