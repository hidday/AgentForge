import { describe, it, expect, vi, beforeEach } from "vitest";

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
  Octokit: vi.fn().mockImplementation(() => mockOctokit),
}));

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("throws on an invalid repo format (missing slash)", async () => {
    await expect(client.getDefaultBranch("not-a-repo")).rejects.toThrow(
      /Invalid repo format "not-a-repo"/,
    );
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("wraps the error with a permissions hint on failure", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("404 Not Found"));
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*404 Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
    });

    it("wraps errors", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("down"));
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*down/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's ref", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("org/repo", "feature/x");

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "sha123",
      });
    });

    it("silently continues when the branch already exists (422)", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
    });

    it("wraps other errors", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockRejectedValue(new Error("rate limited"));

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo".*rate limited/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const num = await client.createDraftPR("org/repo", "head", "base", "Title", "Body");

      expect(num).toBe(42);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "base",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("rethrows on 422 field validation errors", async () => {
      const err = httpError(422, '{"code":"invalid","field":"base"}');
      mockOctokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("org/repo", "head", "base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns an existing open PR on 422 'already exists'", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });

      const num = await client.createDraftPR("org/repo", "head", "base", "Title", "Body");

      expect(num).toBe(7);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "base",
        state: "open",
      });
    });

    it("throws when 422 'already exists' but no matching open PR is found", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      mockOctokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("org/repo", "head", "base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*network down/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({ data: {} });
      await client.commentOnPR("org/repo", 1, "hello");
      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 1,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("nope"));
      await expect(client.commentOnPR("org/repo", 1, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
      await expect(client.getPRDiff("org/repo", 1)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false } });
      await client.markPRReady("org/repo", 1);
      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR as ready via graphql", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      mockOctokit.graphql.mockResolvedValue({});
      await client.markPRReady("org/repo", 1);
      expect(mockOctokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "node-1" },
      );
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, falling back for missing user/body", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01" },
          { id: 2, user: null, body: null, created_at: "2024-01-02" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 1);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02" },
      ]);
    });

    it("wraps errors", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("nope"));
      await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "a.ts", 10);

      expect(id).toBe(555);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "nit",
        path: "a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line isn't in the diff (422)", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 777 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "a.ts", 10);

      expect(id).toBe(777);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "*(line 10)* nit",
        path: "a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 888 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "a.ts");

      expect(id).toBe(888);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "nit",
        path: "a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 when the outer call fails with 422 (file not in diff)", async () => {
      mockOctokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "a.ts");

      expect(id).toBe(0);
    });

    it("rethrows a non-422 line-level error without falling back", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("org/repo", 1, "nit", "a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("wraps non-422 outer errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("down"));

      await expect(client.createPRReviewComment("org/repo", 1, "nit", "a.ts")).rejects.toThrow(
        /GitHub createPRReviewComment failed/,
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("replies successfully", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
      await client.replyToReviewComment("org/repo", 1, 55, "thanks");
      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        comment_id: 55,
        body: "thanks",
      });
    });

    it("swallows errors (logs a warning instead of throwing)", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
      await expect(client.replyToReviewComment("org/repo", 1, 55, "thanks")).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({ data: {} });
      await client.submitPRReview("org/repo", 1, "lgtm", "APPROVE");
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("org/repo", 1, "needs work", "REQUEST_CHANGES");

      expect(mockOctokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "needs work",
        event: "COMMENT",
      });
    });

    it("does not fall back when the event is already COMMENT", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(
        new Error("cannot request changes on own pull request"),
      );

      await expect(client.submitPRReview("org/repo", 1, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });

    it("wraps unrelated errors", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(client.submitPRReview("org/repo", 1, "lgtm", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*rate limited/,
      );
    });
  });
});
