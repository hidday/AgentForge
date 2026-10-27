import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

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

/** Shape of the fake Octokit we inject in place of the real client. */
interface FakeOctokit {
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
}

function makeFakeOctokit(): FakeOctokit {
  return {
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
}

function buildClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeFakeOctokit();
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

describe("RealGitHubClient", () => {
  describe("repo format validation", () => {
    it("rejects a repo string with no slash for every method", async () => {
      const { client } = buildClient();
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        'Invalid repo format "not-a-repo"',
      );
      await expect(client.getDefaultBranch("not-a-repo")).rejects.toThrow(
        'Invalid repo format "not-a-repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("wraps the error with a helpful message when access fails", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(new Error("404 Not Found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*404 Not Found/,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(/boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch on success", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors as 'getDefaultBranch failed'", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*rate limited/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("org/repo", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/issue-1",
        sha: "sha123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("org/repo", "ai/issue-1")).resolves.toBeUndefined();
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("org/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(7);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped field-validation error on 422 with an invalid-field message", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(client.createDraftPR("org/repo", "head", "bad-base", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on 422 'already exists'", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "T", "B");

      expect(prNumber).toBe(55);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error on 422 'already exists' when no matching open PR is found", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed.*network down/,
      );
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on success", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("org/repo", 7, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 7,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));

      await expect(client.commentOnPR("org/repo", 7, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text on success", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("org/repo", 7)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 7)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when the PR is already not a draft", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("org/repo", 7);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 7);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("wraps errors from the graphql mutation", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql failed"));

      await expect(client.markPRReady("org/repo", 7)).rejects.toThrow(
        /GitHub markPRReady failed.*graphql failed/,
      );
    });

    it("wraps errors from fetching the PR", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("pr fetch failed"));

      await expect(client.markPRReady("org/repo", 7)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting author to 'unknown' and body to '' when missing", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 7);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("org/repo", 7)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 123 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(123);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
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

    it("creates a file-level comment when line is omitted", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 456 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts");

      expect(id).toBe(456);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line-level call 422s", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 789 } });

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(789);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 when the line-level call fails with 422 and the fallback also 422s", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockRejectedValueOnce(httpError(422, "file not in diff either"));

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(0);
    });

    it("rethrows a non-422 error from the line-level call, wrapped by the outer catch", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValueOnce(new Error("internal error"));

      await expect(client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts", 10)).rejects.toThrow(
        /GitHub createPRReviewComment failed.*internal error/,
      );
    });

    it("returns 0 when the file-level (no line) call 422s", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "file not in diff"));

      const id = await client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts");

      expect(id).toBe(0);
    });

    it("wraps a non-422 error fetching the PR", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("pr not found"));

      await expect(client.createPRReviewComment("org/repo", 7, "nit", "src/a.ts")).rejects.toThrow(
        /GitHub createPRReviewComment failed.*pr not found/,
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("org/repo", 7, 123, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        comment_id: 123,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(client.replyToReviewComment("org/repo", 7, 123, "thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "org/repo", prNumber: 7, commentId: 123 }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event on success", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("org/repo", 7, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR is rejected", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("org/repo", 7, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 7,
        body: "needs work",
        event: "COMMENT",
      });
    });

    it("propagates a failure from the COMMENT fallback call itself", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("cannot request changes on own pr"))
        .mockRejectedValueOnce(new Error("fallback also failed"));

      await expect(
        client.submitPRReview("org/repo", 7, "needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow("fallback also failed");
    });

    it("does not fall back when the event is already COMMENT, and wraps the error", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("cannot request changes on own pull request"),
      );

      await expect(client.submitPRReview("org/repo", 7, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps an unrelated error without falling back", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(client.submitPRReview("org/repo", 7, "note", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*rate limited/,
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
