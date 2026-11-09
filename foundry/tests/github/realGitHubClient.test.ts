import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@octokit/rest", () => {
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
  return {
    Octokit: vi.fn().mockImplementation(() => mockOctokit),
    __mockOctokit: mockOctokit,
  };
});

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import * as octokitModule from "@octokit/rest";

const mockOctokit = (octokitModule as unknown as { __mockOctokit: typeof octokit }).__mockOctokit;
// Re-declared here only for type inference convenience below.
type octokit = {
  repos: { get: ReturnType<typeof vi.fn> };
  git: { getRef: ReturnType<typeof vi.fn>; createRef: ReturnType<typeof vi.fn> };
  pulls: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    createReviewComment: ReturnType<typeof vi.fn>;
    createReplyForReviewComment: ReturnType<typeof vi.fn>;
    createReview: ReturnType<typeof vi.fn>;
  };
  issues: { createComment: ReturnType<typeof vi.fn>; listComments: ReturnType<typeof vi.fn> };
  graphql: ReturnType<typeof vi.fn>;
};

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
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

  describe("repo format validation", () => {
    it("throws without calling the API when repo is not owner/repo", async () => {
      await expect(client.getDefaultBranch("no-slash")).rejects.toThrow(
        'Invalid repo format "no-slash", expected "owner/repo"',
      );
      expect(mockOctokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs on success", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with a helpful message on failure", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from the API", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors with operation context", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("boom"));
      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets": boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockOctokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "ai/feature-1");

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/ai/feature-1",
        sha: "abc123",
      });
    });

    it("swallows a 422 (branch already exists) and logs info", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockOctokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "ai/feature-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "ai/feature-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 error with branchName context", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("rate limited"));
      await expect(client.createBranch("acme/widgets", "ai/feature-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets" \{"branchName":"ai\/feature-1"\}: rate limited/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 55 } });
      const num = await client.createDraftPR("acme/widgets", "head", "main", "Title", "Body");
      expect(num).toBe(55);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws on a 422 field validation error instead of looking up an existing PR", async () => {
      mockOctokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );
      await expect(
        client.createDraftPR("acme/widgets", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(mockOctokit.pulls.list).not.toHaveBeenCalled();
    });

    it("returns the existing open PR number on a 422 duplicate-head error", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR("acme/widgets", "head", "main", "Title", "Body");

      expect(num).toBe(77);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 duplicate-head error has no matching existing PR", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({});
      await client.commentOnPR("acme/widgets", 10, "hello");
      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("down"));
      await expect(client.commentOnPR("acme/widgets", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets" \{"prNumber":10\}: down/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: MOCK_DIFF });
      const diff = await client.getPRDiff(MOCK_REPO_CONFIG.name, 10);
      expect(diff).toBe(MOCK_DIFF);
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.getPRDiff("acme/widgets", 10)).rejects.toThrow(
        /GitHub getPRDiff failed/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via the GraphQL mutation", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      mockOctokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 10);

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 10);

      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("fail"));
      await expect(client.markPRReady("acme/widgets", 10)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps API comments to PRComment, defaulting missing fields", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("fail"));
      await expect(client.listPRComments("acme/widgets", 10)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    });

    it("creates a line-level comment when a line is given", async () => {
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "fix this",
        "src/a.ts",
        5,
      );

      expect(id).toBe(500);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "fix this",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 501 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "fix this",
        "src/a.ts",
        5,
      );

      expect(id).toBe(501);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "*(line 5)* fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const id = await client.createPRReviewComment("acme/widgets", 10, "general note", "src/a.ts");

      expect(id).toBe(502);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "general note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("returns 0 and logs a warning when the file-level fallback also fails with 422", async () => {
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockRejectedValueOnce(httpError(422, "file not in diff either"));

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "fix this",
        "src/a.ts",
        5,
      );

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 10, path: "src/a.ts", line: 5 },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("rethrows a non-422 error from the line-level attempt without trying the file-level fallback", async () => {
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(new Error("internal error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "fix this", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);

      // Only the line-level attempt should have been made; no file-level fallback.
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(1);
    });

    it("rethrows a non-422 error from the pulls.get lookup", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("network down"));
      await expect(
        client.createPRReviewComment("acme/widgets", 10, "x", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply and logs debug on success", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await client.replyToReviewComment("acme/widgets", 10, 500, "thanks");
      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        comment_id: 500,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));
      await expect(
        client.replyToReviewComment("acme/widgets", 10, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "acme/widgets", prNumber: 10, commentId: 500 }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("acme/widgets", 10, "LGTM", "APPROVE");
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the author's own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 10, "Needs work", "REQUEST_CHANGES");

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(mockOctokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "Needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not fall back when the event is already COMMENT", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      await expect(
        client.submitPRReview("acme/widgets", 10, "note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps unrelated errors", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));
      await expect(
        client.submitPRReview("acme/widgets", 10, "note", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets" \{"prNumber":10,"event":"APPROVE"\}: rate limited/);
    });
  });
});
