import { describe, it, expect, vi } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeOctokit = Record<string, any>;

function makeClient(octokit: FakeOctokit, logger = makeLogger()) {
  const client = new RealGitHubClient("test-token", logger as never);
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, logger };
}

function httpError(status: number, message = "GitHub error") {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  describe("repo format validation", () => {
    it("rejects a repo string with no slash before making any API call", async () => {
      const repos = { get: vi.fn() };
      const { client } = makeClient({ repos });

      await expect(client.verifyRepoAccess("invalid")).rejects.toThrow(
        'Invalid repo format "invalid", expected "owner/repo"',
      );
      expect(repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs when the repo is accessible", async () => {
      const repos = { get: vi.fn().mockResolvedValue({ data: {} }) };
      const { client, logger } = makeClient({ repos });

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with context and preserves it as cause", async () => {
      const original = new Error("Not Found");
      const repos = { get: vi.fn().mockRejectedValue(original) };
      const { client } = makeClient({ repos });

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toMatchObject({
        message: expect.stringContaining('cannot access repo "owner/repo"'),
        cause: original,
      });
    });

    it("stringifies a non-Error thrown value in the wrapped message", async () => {
      const repos = { get: vi.fn().mockRejectedValue("plain string failure") };
      const { client } = makeClient({ repos });

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        "Original: plain string failure",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      const repos = { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) };
      const { client } = makeClient({ repos });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
    });

    it("throws a wrapped error on failure", async () => {
      const repos = { get: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ repos });

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo"',
      );
    });

    it("stringifies a non-Error thrown value in the wrapped message", async () => {
      const repos = { get: vi.fn().mockRejectedValue({ weird: "object" }) };
      const { client } = makeClient({ repos });

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow("[object Object]");
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      const repos = { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) };
      const git = {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
        createRef: vi.fn().mockResolvedValue({}),
      };
      const { client } = makeClient({ repos, git });

      await client.createBranch("owner/repo", "ai/feature");

      expect(git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "abc123",
      });
    });

    it("treats a 422 as the branch already existing and does not throw", async () => {
      const repos = { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) };
      const git = {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
        createRef: vi.fn().mockRejectedValue(httpError(422)),
      };
      const { client, logger } = makeClient({ repos, git });

      await expect(client.createBranch("owner/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/feature" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("throws a wrapped error for non-422 failures", async () => {
      const repos = { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) };
      const git = {
        getRef: vi.fn().mockRejectedValue(httpError(500, "server error")),
      };
      const { client } = makeClient({ repos, git });

      await expect(client.createBranch("owner/repo", "ai/feature")).rejects.toThrow(
        'GitHub createBranch failed for "owner/repo"',
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the created PR number", async () => {
      const pulls = { create: vi.fn().mockResolvedValue({ data: { number: 55 } }) };
      const { client } = makeClient({ pulls });

      const num = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(num).toBe(55);
      expect(pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error for a 422 caused by field validation", async () => {
      const err = httpError(422, '{"code":"invalid","field":"base"}');
      const pulls = { create: vi.fn().mockRejectedValue(err) };
      const { client, logger } = makeClient({ pulls });

      await expect(client.createDraftPR("owner/repo", "head", "main", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo"',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error for a 422 caused by a missing field", async () => {
      const err = httpError(422, '{"code":"missing_field","field":"title"}');
      const pulls = { create: vi.fn().mockRejectedValue(err) };
      const { client } = makeClient({ pulls });

      await expect(client.createDraftPR("owner/repo", "head", "main", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo"',
      );
    });

    it("treats a non-Error 422 rejection as a non-field-validation duplicate-head lookup", async () => {
      const err = { status: 422 };
      const pulls = {
        create: vi.fn().mockRejectedValue(err),
        list: vi.fn().mockResolvedValue({ data: [{ number: 88 }] }),
      };
      const { client } = makeClient({ pulls });

      await expect(client.createDraftPR("owner/repo", "head", "main", "T", "B")).resolves.toBe(88);
    });

    it("returns the existing open PR number when a 422 indicates a duplicate head branch", async () => {
      const err = httpError(422, "A pull request already exists for owner:head");
      const pulls = {
        create: vi.fn().mockRejectedValue(err),
        list: vi.fn().mockResolvedValue({ data: [{ number: 77 }] }),
      };
      const { client, logger } = makeClient({ pulls });

      const num = await client.createDraftPR("owner/repo", "head", "main", "T", "B");

      expect(num).toBe(77);
      expect(pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 77 },
        "Found existing open PR",
      );
    });

    it("throws a wrapped error when a 422 duplicate lookup finds no existing open PR", async () => {
      const err = httpError(422, "A pull request already exists for owner:head");
      const pulls = {
        create: vi.fn().mockRejectedValue(err),
        list: vi.fn().mockResolvedValue({ data: [] }),
      };
      const { client } = makeClient({ pulls });

      await expect(client.createDraftPR("owner/repo", "head", "main", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo"',
      );
    });

    it("throws a wrapped error for non-422 failures", async () => {
      const pulls = { create: vi.fn().mockRejectedValue(httpError(500)) };
      const { client } = makeClient({ pulls });

      await expect(client.createDraftPR("owner/repo", "head", "main", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo"',
      );
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment via issues.createComment", async () => {
      const issues = { createComment: vi.fn().mockResolvedValue({}) };
      const { client } = makeClient({ issues });

      await client.commentOnPR("owner/repo", 5, "hi");

      expect(issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 5,
        body: "hi",
      });
    });

    it("throws a wrapped error on failure", async () => {
      const issues = { createComment: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ issues });

      await expect(client.commentOnPR("owner/repo", 5, "hi")).rejects.toThrow(
        'GitHub commentOnPR failed for "owner/repo"',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      const pulls = { get: vi.fn().mockResolvedValue({ data: "diff --git a b" }) };
      const { client } = makeClient({ pulls });

      await expect(client.getPRDiff("owner/repo", 5)).resolves.toBe("diff --git a b");
      expect(pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("throws a wrapped error on failure", async () => {
      const pulls = { get: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ pulls });

      await expect(client.getPRDiff("owner/repo", 5)).rejects.toThrow(
        'GitHub getPRDiff failed for "owner/repo"',
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      const pulls = { get: vi.fn().mockResolvedValue({ data: { draft: false, node_id: "n1" } }) };
      const graphql = vi.fn();
      const { client } = makeClient({ pulls, graphql });

      await client.markPRReady("owner/repo", 5);

      expect(graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR as ready via the GraphQL mutation", async () => {
      const pulls = { get: vi.fn().mockResolvedValue({ data: { draft: true, node_id: "n1" } }) };
      const graphql = vi.fn().mockResolvedValue({});
      const { client, logger } = makeClient({ pulls, graphql });

      await client.markPRReady("owner/repo", 5);

      expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "n1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error when the graphql mutation fails", async () => {
      const pulls = { get: vi.fn().mockResolvedValue({ data: { draft: true, node_id: "n1" } }) };
      const graphql = vi.fn().mockRejectedValue(new Error("boom"));
      const { client } = makeClient({ pulls, graphql });

      await expect(client.markPRReady("owner/repo", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo"',
      );
    });

    it("throws a wrapped error when fetching the PR fails", async () => {
      const pulls = { get: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ pulls });

      await expect(client.markPRReady("owner/repo", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo"',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author and body", async () => {
      const issues = {
        listComments: vi.fn().mockResolvedValue({
          data: [
            { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
            { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
          ],
        }),
      };
      const { client } = makeClient({ issues });

      const comments = await client.listPRComments("owner/repo", 5);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("throws a wrapped error on failure", async () => {
      const issues = { listComments: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ issues });

      await expect(client.listPRComments("owner/repo", 5)).rejects.toThrow(
        'GitHub listPRComments failed for "owner/repo"',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment on the RIGHT side when a line is given", async () => {
      const pulls = {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment: vi.fn().mockResolvedValue({ data: { id: 900 } }),
      };
      const { client } = makeClient({ pulls });

      const id = await client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts", 10);

      expect(id).toBe(900);
      expect(pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "body",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is given", async () => {
      const pulls = {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment: vi.fn().mockResolvedValue({ data: { id: 901 } }),
      };
      const { client } = makeClient({ pulls });

      const id = await client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts");

      expect(id).toBe(901);
      expect(pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line-level comment fails with 422", async () => {
      const createReviewComment = vi
        .fn()
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 902 } });
      const pulls = {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment,
      };
      const { client, logger } = makeClient({ pulls });

      const id = await client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts", 10);

      expect(id).toBe(902);
      expect(createReviewComment).toHaveBeenCalledTimes(2);
      expect(createReviewComment).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "*(line 10)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level failure, wrapped by the outer handler", async () => {
      const createReviewComment = vi.fn().mockRejectedValue(httpError(500, "server error"));
      const pulls = {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment,
      };
      const { client } = makeClient({ pulls });

      await expect(
        client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
      expect(createReviewComment).toHaveBeenCalledTimes(1);
    });

    it("returns 0 and logs a warning when the outer call fails with 422 (file not in diff)", async () => {
      const pulls = { get: vi.fn().mockRejectedValue(httpError(422)) };
      const { client, logger } = makeClient({ pulls });

      const id = await client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("throws a wrapped error for a non-422 outer failure", async () => {
      const pulls = { get: vi.fn().mockRejectedValue(httpError(500)) };
      const { client } = makeClient({ pulls });

      await expect(
        client.createPRReviewComment("owner/repo", 5, "body", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply and does not throw", async () => {
      const pulls = { createReplyForReviewComment: vi.fn().mockResolvedValue({}) };
      const { client, logger } = makeClient({ pulls });

      await client.replyToReviewComment("owner/repo", 5, 900, "reply body");

      expect(pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        comment_id: 900,
        body: "reply body",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows failures, logging a warning instead of throwing", async () => {
      const pulls = { createReplyForReviewComment: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client, logger } = makeClient({ pulls });

      await expect(
        client.replyToReviewComment("owner/repo", 5, 900, "reply body"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection in the logged warning", async () => {
      const pulls = { createReplyForReviewComment: vi.fn().mockRejectedValue("plain failure") };
      const { client, logger } = makeClient({ pulls });

      await client.replyToReviewComment("owner/repo", 5, 900, "reply body");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain failure" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      const pulls = { createReview: vi.fn().mockResolvedValue({}) };
      const { client } = makeClient({ pulls });

      await client.submitPRReview("owner/repo", 5, "lgtm", "APPROVE");

      expect(pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because it's the author's own PR", async () => {
      const createReview = vi
        .fn()
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockResolvedValueOnce({});
      const pulls = { createReview };
      const { client, logger } = makeClient({ pulls });

      await client.submitPRReview("owner/repo", 5, "please fix", "REQUEST_CHANGES");

      expect(createReview).toHaveBeenCalledTimes(2);
      expect(createReview).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error when the event is already COMMENT and the call fails", async () => {
      const pulls = { createReview: vi.fn().mockRejectedValue(new Error("boom")) };
      const { client } = makeClient({ pulls });

      await expect(client.submitPRReview("owner/repo", 5, "note", "COMMENT")).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo"',
      );
    });

    it("throws a wrapped error when the failure message does not match the own-PR pattern", async () => {
      const pulls = { createReview: vi.fn().mockRejectedValue(new Error("some other failure")) };
      const { client } = makeClient({ pulls });

      await expect(
        client.submitPRReview("owner/repo", 5, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });

    it("stringifies a non-Error rejection when checking for the own-PR pattern", async () => {
      const pulls = { createReview: vi.fn().mockRejectedValue({ notAnError: true }) };
      const { client } = makeClient({ pulls });

      await expect(
        client.submitPRReview("owner/repo", 5, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
      expect(pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
