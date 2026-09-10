import { describe, it, expect, vi, beforeEach } from "vitest";
import { Octokit } from "@octokit/rest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";
import type { Logger } from "../../src/utils/logger.js";

vi.mock("@octokit/rest", () => ({ Octokit: vi.fn() }));

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("RealGitHubClient", () => {
  let fakeOctokit: {
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
  let logger: Logger;
  let client: RealGitHubClient;

  beforeEach(() => {
    fakeOctokit = {
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
    vi.mocked(Octokit).mockImplementation(() => fakeOctokit as never);
    logger = makeLogger();
    client = new RealGitHubClient("token-123", logger);
  });

  describe("splitRepo (via any public method)", () => {
    it("throws 'Invalid repo format' when the repo string has no slash", async () => {
      await expect(client.getDefaultBranch("noslash")).rejects.toThrow(
        'Invalid repo format "noslash", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs on success", async () => {
      fakeOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();

      expect(fakeOctokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo" },
        "Verified GitHub repo access",
      );
    });

    it("throws the distinct custom access-denied message on failure", async () => {
      fakeOctokit.repos.get.mockRejectedValue(new Error("404 Not Found"));

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        'GitHub: cannot access repo "owner/repo". Check that GITHUB_TOKEN has repository access permissions. Original: 404 Not Found',
      );
    });

    it("stringifies a non-Error rejection value in the access-denied message", async () => {
      fakeOctokit.repos.get.mockRejectedValue("weird string failure");

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        'GitHub: cannot access repo "owner/repo". Check that GITHUB_TOKEN has repository access permissions. Original: weird string failure',
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      fakeOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
      expect(fakeOctokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
    });

    it("throws the wrapped error message on failure", async () => {
      fakeOctokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo": boom',
      );
    });

    it("stringifies a non-Error rejection value in the wrapped error (wrapError fallback)", async () => {
      fakeOctokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo": plain string failure',
      );
    });
  });

  describe("createBranch", () => {
    it("chains repos.get -> git.getRef -> git.createRef using default_branch and sha", async () => {
      fakeOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      fakeOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-abc" } } });
      fakeOctokit.git.createRef.mockResolvedValue({});

      await client.createBranch("owner/repo", "feature/x");

      expect(fakeOctokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(fakeOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(fakeOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "sha-abc",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      fakeOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      fakeOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-abc" } } });
      const err = Object.assign(new Error("Reference already exists"), { status: 422 });
      fakeOctokit.git.createRef.mockRejectedValue(err);

      await expect(client.createBranch("owner/repo", "feature/x")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("throws the wrapped error for a non-422 failure", async () => {
      fakeOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      fakeOctokit.git.getRef.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("owner/repo", "feature/x")).rejects.toThrow(
        'GitHub createBranch failed for "owner/repo" {"branchName":"feature/x"}: network error',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number on success", async () => {
      fakeOctokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const result = await client.createDraftPR(
        "owner/repo",
        "feature/x",
        "main",
        "My title",
        "My body",
      );

      expect(result).toBe(42);
      expect(fakeOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "feature/x",
        base: "main",
        title: "My title",
        body: "My body",
        draft: true,
      });
    });

    it("throws the wrapped error for a non-422 failure", async () => {
      fakeOctokit.pulls.create.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createDraftPR("owner/repo", "feature/x", "main", "t", "b"),
      ).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo" {"head":"feature/x","base":"main"}: server exploded',
      );
    });

    it("on a 422 field-validation error, logs and throws the wrapped error without listing PRs", async () => {
      const err = Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 });
      fakeOctokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("owner/repo", "feature/x", "main", "t", "b"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');

      expect(fakeOctokit.pulls.list).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { repo: "owner/repo", head: "feature/x", base: "main", detail: err.message },
        "PR creation failed: invalid field (base branch may not exist)",
      );
    });

    it("on a 422 duplicate-PR error, looks up and returns the existing open PR number", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      fakeOctokit.pulls.create.mockRejectedValue(err);
      fakeOctokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR("owner/repo", "feature/x", "main", "t", "b");

      expect(result).toBe(77);
      expect(fakeOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:feature/x",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 77 },
        "Found existing open PR",
      );
    });

    it("treats a non-Error 422 rejection as non-field-validation and looks up the existing PR", async () => {
      const nonErrorRejection = { status: 422, toString: () => '"weird" object' };
      fakeOctokit.pulls.create.mockRejectedValue(nonErrorRejection);
      fakeOctokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const result = await client.createDraftPR("owner/repo", "feature/x", "main", "t", "b");

      expect(result).toBe(55);
      expect(fakeOctokit.pulls.list).toHaveBeenCalled();
    });

    it("on a 422 duplicate-PR error with no existing open PR found, throws the wrapped error", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      fakeOctokit.pulls.create.mockRejectedValue(err);
      fakeOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "feature/x", "main", "t", "b"),
      ).rejects.toThrow(
        'GitHub createDraftPR failed for "owner/repo" {"head":"feature/x","base":"main"}: A pull request already exists',
      );
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      fakeOctokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("owner/repo", 5, "hello");

      expect(fakeOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 5,
        body: "hello",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5 },
        "Commented on PR",
      );
    });

    it("throws the wrapped error on failure", async () => {
      fakeOctokit.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("owner/repo", 5, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "owner/repo" {"prNumber":5}: rate limited',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff data on success", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      const result = await client.getPRDiff("owner/repo", 5);

      expect(result).toBe("diff --git a b");
      expect(fakeOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("throws the wrapped error on failure", async () => {
      fakeOctokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("owner/repo", 5)).rejects.toThrow(
        'GitHub getPRDiff failed for "owner/repo" {"prNumber":5}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql when draft is true", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      fakeOctokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 5);

      expect(fakeOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5 },
        "Marked PR as ready for review",
      );
    });

    it("is a no-op (does not call graphql) when the PR is already not a draft", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("owner/repo", 5);

      expect(fakeOctokit.graphql).not.toHaveBeenCalled();
    });

    it("throws the wrapped error on failure", async () => {
      fakeOctokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("owner/repo", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo" {"prNumber":5}: gone',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps octokit comments to PRComment[] on success", async () => {
      fakeOctokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "hi",
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

      const result = await client.listPRComments("owner/repo", 5);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
      expect(fakeOctokit.issues.listComments).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 5,
      });
    });

    it("throws the wrapped error on failure", async () => {
      fakeOctokit.issues.listComments.mockRejectedValue(new Error("timeout"));

      await expect(client.listPRComments("owner/repo", 5)).rejects.toThrow(
        'GitHub listPRComments failed for "owner/repo" {"prNumber":5}: timeout',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates an inline review comment when line is provided", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "commit-sha" } } });
      fakeOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 999 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        5,
        "body text",
        "src/a.ts",
        10,
      );

      expect(result).toBe(999);
      expect(fakeOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "body text",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "commit-sha",
      });
    });

    it("creates a file-level comment when line is omitted", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "commit-sha" } } });
      fakeOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 998 } });

      const result = await client.createPRReviewComment("owner/repo", 5, "body text", "src/a.ts");

      expect(result).toBe(998);
      expect(fakeOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "body text",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-sha",
      });
    });

    it("falls back to a file-level comment when the line-level attempt gets a 422", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "commit-sha" } } });
      const lineErr = Object.assign(new Error("line not in diff"), { status: 422 });
      fakeOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(lineErr)
        .mockResolvedValueOnce({ data: { id: 997 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        5,
        "body text",
        "src/a.ts",
        10,
      );

      expect(result).toBe(997);
      expect(fakeOctokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "*(line 10)* body text",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-sha",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, path: "src/a.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("rethrows a non-422 error from the line-level attempt, which is then wrapped", async () => {
      fakeOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "commit-sha" } } });
      fakeOctokit.pulls.createReviewComment.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("owner/repo", 5, "body text", "src/a.ts", 10),
      ).rejects.toThrow(
        'GitHub createPRReviewComment failed for "owner/repo" {"prNumber":5,"path":"src/a.ts","line":10}: network down',
      );
    });

    it("returns 0 and logs a warning on an outer 422 (file not in diff)", async () => {
      const err = Object.assign(new Error("outer 422"), { status: 422 });
      fakeOctokit.pulls.get.mockRejectedValue(err);

      const result = await client.createPRReviewComment("owner/repo", 5, "body text", "src/a.ts", 10);

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, path: "src/a.ts", line: 10 },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("throws the wrapped error for a non-422 outer failure", async () => {
      fakeOctokit.pulls.get.mockRejectedValue(new Error("pr fetch failed"));

      await expect(
        client.createPRReviewComment("owner/repo", 5, "body text", "src/a.ts", 10),
      ).rejects.toThrow(
        'GitHub createPRReviewComment failed for "owner/repo" {"prNumber":5,"path":"src/a.ts","line":10}: pr fetch failed',
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success and logs debug", async () => {
      fakeOctokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("owner/repo", 5, 1000, "reply text");

      expect(fakeOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        comment_id: 1000,
        body: "reply text",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, commentId: 1000 },
        "Replied to PR review comment",
      );
    });

    it("swallows errors, logging a warning instead of throwing", async () => {
      fakeOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("owner/repo", 5, 1000, "reply text"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, commentId: 1000, error: "comment gone" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection value in the swallowed warning", async () => {
      fakeOctokit.pulls.createReplyForReviewComment.mockRejectedValue("comment vanished");

      await expect(
        client.replyToReviewComment("owner/repo", 5, 1000, "reply text"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, commentId: 1000, error: "comment vanished" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review on success", async () => {
      fakeOctokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("owner/repo", 5, "review body", "APPROVE");

      expect(fakeOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "review body",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, event: "APPROVE" },
        "Submitted PR review",
      );
    });

    it("falls back to COMMENT when requesting changes on own PR fails with the specific message", async () => {
      fakeOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("owner/repo", 5, "review body", "REQUEST_CHANGES");

      expect(fakeOctokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 5,
        body: "review body",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 5, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("does not fall back when event is already COMMENT, and throws the wrapped error", async () => {
      fakeOctokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("owner/repo", 5, "review body", "COMMENT"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo" {"prNumber":5,"event":"COMMENT"}: Can not request changes on your own pull request',
      );
      expect(fakeOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws the wrapped error for an unrelated failure", async () => {
      fakeOctokit.pulls.createReview.mockRejectedValue(new Error("server error"));

      await expect(
        client.submitPRReview("owner/repo", 5, "review body", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo" {"prNumber":5,"event":"APPROVE"}: server error',
      );
    });

    it("stringifies a non-Error rejection value (does not match the own-PR regex, so it wraps and throws)", async () => {
      fakeOctokit.pulls.createReview.mockRejectedValue("unexpected failure");

      await expect(
        client.submitPRReview("owner/repo", 5, "review body", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo" {"prNumber":5,"event":"APPROVE"}: unexpected failure',
      );
    });
  });
});
