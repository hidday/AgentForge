import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReposGet = vi.fn();
const mockGetRef = vi.fn();
const mockCreateRef = vi.fn();
const mockPullsCreate = vi.fn();
const mockPullsList = vi.fn();
const mockPullsGet = vi.fn();
const mockCreateReviewComment = vi.fn();
const mockCreateReplyForReviewComment = vi.fn();
const mockCreateReview = vi.fn();
const mockIssuesCreateComment = vi.fn();
const mockIssuesListComments = vi.fn();
const mockGraphql = vi.fn();

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => ({
      repos: { get: mockReposGet },
      git: { getRef: mockGetRef, createRef: mockCreateRef },
      pulls: {
        create: mockPullsCreate,
        list: mockPullsList,
        get: mockPullsGet,
        createReviewComment: mockCreateReviewComment,
        createReplyForReviewComment: mockCreateReplyForReviewComment,
        createReview: mockCreateReview,
      },
      issues: { createComment: mockIssuesCreateComment, listComments: mockIssuesListComments },
      graphql: mockGraphql,
    })),
  };
});

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function httpError(message: string, status?: number) {
  const err = new Error(message) as Error & { status?: number };
  if (status !== undefined) err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("fake-token", logger as never);
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      mockReposGet.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(mockReposGet).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("rejects with a descriptive error when repos.get fails", async () => {
      mockReposGet.mockRejectedValue(new Error("not found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*not found/,
      );
    });

    it("rejects when repo format is invalid", async () => {
      await expect(client.verifyRepoAccess("invalid-format")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      mockReposGet.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
    });

    it("wraps errors with operation context", async () => {
      mockReposGet.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch head sha", async () => {
      mockReposGet.mockResolvedValue({ data: { default_branch: "main" } });
      mockGetRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockCreateRef.mockResolvedValue({ data: {} });

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
      expect(mockGetRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(mockCreateRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      mockReposGet.mockResolvedValue({ data: { default_branch: "main" } });
      mockGetRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockCreateRef.mockRejectedValue(httpError("Reference already exists", 422));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps other errors", async () => {
      mockReposGet.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo"/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      mockPullsCreate.mockResolvedValue({ data: { number: 101 } });

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
      ).resolves.toBe(101);
      expect(mockPullsCreate).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "feature/x",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("looks up and returns an existing open PR on a non-field 422", async () => {
      mockPullsCreate.mockRejectedValue(httpError("A pull request already exists", 422));
      mockPullsList.mockResolvedValue({ data: [{ number: 55 }] });

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
      ).resolves.toBe(55);
      expect(mockPullsList).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:feature/x",
        base: "main",
        state: "open",
      });
    });

    it("throws when field validation fails (422 with invalid/missing_field code)", async () => {
      mockPullsCreate.mockRejectedValue(
        httpError('Validation Failed: {"code":"invalid","field":"base"}', 422),
      );

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws when a non-field 422 occurs but no existing PR is found", async () => {
      mockPullsCreate.mockRejectedValue(httpError("conflict", 422));
      mockPullsList.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      mockPullsCreate.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      mockIssuesCreateComment.mockResolvedValue({ data: {} });

      await expect(client.commentOnPR("org/repo", 7, "hello")).resolves.toBeUndefined();
      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 7,
        body: "hello",
      });
    });

    it("wraps errors with the PR number in context", async () => {
      mockIssuesCreateComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("org/repo", 7, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "org\/repo" \{"prNumber":7\}/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      mockPullsGet.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("org/repo", 7)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors", async () => {
      mockPullsGet.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 7)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      mockPullsGet.mockResolvedValue({ data: { draft: false } });

      await expect(client.markPRReady("org/repo", 7)).resolves.toBeUndefined();
      expect(mockGraphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when draft", async () => {
      mockPullsGet.mockResolvedValue({ data: { draft: true, node_id: "PR_node123" } });
      mockGraphql.mockResolvedValue({});

      await expect(client.markPRReady("org/repo", 7)).resolves.toBeUndefined();
      expect(mockGraphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReady"), {
        prId: "PR_node123",
      });
    });

    it("wraps errors", async () => {
      mockPullsGet.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("org/repo", 7)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments and falls back for missing user/body", async () => {
      mockIssuesListComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 7);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      mockIssuesListComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("org/repo", 7)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line comment when line is provided", async () => {
      mockPullsGet.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockCreateReviewComment.mockResolvedValue({ data: { id: 999 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(999);
      expect(mockCreateReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      mockPullsGet.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockCreateReviewComment
        .mockRejectedValueOnce(httpError("line not in diff", 422))
        .mockResolvedValueOnce({ data: { id: 1000 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(1000);
      expect(mockCreateReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment when no line is provided", async () => {
      mockPullsGet.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockCreateReviewComment.mockResolvedValue({ data: { id: 42 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts");

      expect(id).toBe(42);
      expect(mockCreateReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning on an outer 422 (file not in diff)", async () => {
      mockPullsGet.mockRejectedValue(httpError("file not in diff", 422));

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level error without falling back", async () => {
      mockPullsGet.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockCreateReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("wraps a non-422 outer error", async () => {
      mockPullsGet.mockRejectedValue(new Error("boom"));

      await expect(client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts")).rejects.toThrow(
        /GitHub createPRReviewComment failed/,
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to a review comment on success", async () => {
      mockCreateReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(
        client.replyToReviewComment("org/repo", 7, 123, "thanks"),
      ).resolves.toBeUndefined();
      expect(mockCreateReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        comment_id: 123,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      mockCreateReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("org/repo", 7, 123, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      mockCreateReview.mockResolvedValue({ data: {} });

      await expect(
        client.submitPRReview("org/repo", 7, "LGTM", "APPROVE"),
      ).resolves.toBeUndefined();
      expect(mockCreateReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the PR author", async () => {
      mockCreateReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("org/repo", 7, "please fix", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();
      expect(mockCreateReview).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "please fix",
        event: "COMMENT",
      });
    });

    it("wraps other errors instead of falling back", async () => {
      mockCreateReview.mockRejectedValue(new Error("server error"));

      await expect(
        client.submitPRReview("org/repo", 7, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps errors for COMMENT event without attempting a fallback", async () => {
      mockCreateReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("org/repo", 7, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
      expect(mockCreateReview).toHaveBeenCalledTimes(1);
    });
  });
});
