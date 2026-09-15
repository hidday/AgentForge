import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "../../src/utils/logger.js";

const mockOctokit = {
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
  Octokit: vi.fn(() => mockOctokit),
}));

const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeErr(status: number, message = "error"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let logger: Logger;
  let client: InstanceType<typeof RealGitHubClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("fake-token", logger);
  });

  describe("splitRepo validation", () => {
    it("throws on an invalid repo format (no slash)", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs on success", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();

      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo" },
        "Verified GitHub repo access",
      );
    });

    it("wraps the error on failure", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("no access"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        'GitHub: cannot access repo "org/repo". Check that GITHUB_TOKEN has repository access permissions. Original: no access',
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps the error on failure", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo": boom',
      );
    });
  });

  describe("createBranch", () => {
    it("creates the branch from the default branch head sha", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockOctokit.git.createRef.mockResolvedValue({ data: {} });

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("swallows a 422 (branch already exists) and continues", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockOctokit.git.createRef.mockRejectedValue(makeErr(422));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("rethrows a wrapped error for a non-422 failure", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockOctokit.git.createRef.mockRejectedValue(makeErr(500, "server exploded"));

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        'GitHub createBranch failed for "org/repo" {"branchName":"feature/x"}: server exploded',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates the PR and returns its number", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      await expect(
        client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
      ).resolves.toBe(55);

      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head-branch",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("rethrows with detail on a 422 field validation error", async () => {
      const err = makeErr(422, 'Validation failed: {"code":"invalid","field":"base"}');
      mockOctokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);

      expect(logger.error).toHaveBeenCalled();
    });

    it("rethrows with detail on a 422 missing_field validation error", async () => {
      const err = makeErr(422, '{"code":"missing_field","field":"title"}');
      mockOctokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
    });

    it("returns the existing PR number when a 422 means the PR already exists", async () => {
      const err = makeErr(422, "A pull request already exists");
      mockOctokit.pulls.create.mockRejectedValue(err);
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      await expect(
        client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
      ).resolves.toBe(77);

      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head-branch",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 77 },
        "Found existing open PR",
      );
    });

    it("rethrows when a 422 duplicate-PR error has no existing PR found", async () => {
      const err = makeErr(422, "A pull request already exists");
      mockOctokit.pulls.create.mockRejectedValue(err);
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(
        'GitHub createDraftPR failed for "org/repo" {"head":"head-branch","base":"main"}: A pull request already exists',
      );
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({ data: {} });

      await expect(client.commentOnPR("org/repo", 10, "hi there")).resolves.toBeUndefined();

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 10,
        body: "hi there",
      });
    });

    it("wraps the error on failure", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("nope"));

      await expect(client.commentOnPR("org/repo", 10, "hi there")).rejects.toThrow(
        'GitHub commentOnPR failed for "org/repo" {"prNumber":10}: nope',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("org/repo", 10)).resolves.toBe("diff --git a b");

      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("wraps the error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("diff failed"));

      await expect(client.getPRDiff("org/repo", 10)).rejects.toThrow(
        'GitHub getPRDiff failed for "org/repo" {"prNumber":10}: diff failed',
      );
    });
  });

  describe("markPRReady", () => {
    it("short-circuits when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await expect(client.markPRReady("org/repo", 10)).resolves.toBeUndefined();

      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the graphql mutation when the PR is a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      mockOctokit.graphql.mockResolvedValue({});

      await expect(client.markPRReady("org/repo", 10)).resolves.toBeUndefined();

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10 },
        "Marked PR as ready for review",
      );
    });

    it("wraps the error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("get failed"));

      await expect(client.markPRReady("org/repo", 10)).rejects.toThrow(
        'GitHub markPRReady failed for "org/repo" {"prNumber":10}: get failed',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments and applies fallbacks for missing user/body", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "hello",
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: 2,
            user: null,
            body: null,
            created_at: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const result = await client.listPRComments("org/repo", 10);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps the error on failure", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("list failed"));

      await expect(client.listPRComments("org/repo", 10)).rejects.toThrow(
        'GitHub listPRComments failed for "org/repo" {"prNumber":10}: list failed',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line comment successfully when a line is provided", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const result = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 5);

      expect(result).toBe(500);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line comment gets a 422", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(makeErr(422))
        .mockResolvedValueOnce({ data: { id: 501 } });

      const result = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 5);

      expect(result).toBe(501);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, path: "src/a.ts", line: 5 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("creates a file-level comment when no line is provided", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const result = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts");

      expect(result).toBe(502);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("swallows a non-line 422 error and returns 0", async () => {
      mockOctokit.pulls.get.mockRejectedValue(makeErr(422, "file not in diff"));

      const result = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts");

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, path: "src/a.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("rethrows a genuinely different (non-422) error", async () => {
      mockOctokit.pulls.get.mockRejectedValue(makeErr(500, "server error"));

      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/a.ts"),
      ).rejects.toThrow(
        'GitHub createPRReviewComment failed for "org/repo" {"prNumber":10,"path":"src/a.ts"}: server error',
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("posts the reply successfully", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(
        client.replyToReviewComment("org/repo", 10, 500, "a reply"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        comment_id: 500,
        body: "a reply",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, commentId: 500 },
        "Replied to PR review comment",
      );
    });

    it("swallows a failure and only logs a warning, does not throw", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("reply failed"));

      await expect(
        client.replyToReviewComment("org/repo", 10, 500, "a reply"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, commentId: 500, error: "reply failed" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review successfully", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({ data: {} });

      await expect(
        client.submitPRReview("org/repo", 10, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("org/repo", 10, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 10, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("rethrows a non-matching error", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("totally unrelated failure"));

      await expect(
        client.submitPRReview("org/repo", 10, "needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "org/repo" {"prNumber":10,"event":"REQUEST_CHANGES"}: totally unrelated failure',
      );
    });
  });
});
