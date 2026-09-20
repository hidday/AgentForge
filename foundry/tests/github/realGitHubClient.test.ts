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

function makeFakeOctokit(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function installFakeOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    octokit = makeFakeOctokit();
    installFakeOctokit(client, octokit);
  });

  describe("splitRepo validation", () => {
    it("throws before calling the API when the repo has no slash", async () => {
      await expect(client.verifyRepoAccess("invalid-repo")).rejects.toThrow(
        'Invalid repo format "invalid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
    });

    it("wraps an Error thrown by the API with a helpful message", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        'GitHub: cannot access repo "owner/repo". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
      );
    });

    it("stringifies a non-Error thrown value", async () => {
      octokit.repos.get.mockRejectedValue("weird failure");
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        "Original: weird failure",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps failures", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo": rate limited',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch head", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("owner/repo", "ai/new-branch");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/new-branch",
        sha: "sha123",
      });
    });

    it("swallows a 422 (branch already exists) and logs instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("owner/repo", "ai/dup")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/dup" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 failure", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("owner/repo", "ai/x")).rejects.toThrow(
        'GitHub createBranch failed for "owner/repo" {"branchName":"ai/x"}: network down',
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws immediately on a field-validation 422 (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "missing-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a duplicate-head 422", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a duplicate-head 422 has no matching existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("wraps a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo" {"head":"head","base":"main"}: server error');
    });
  });

  describe("commentOnPR", () => {
    it("posts the comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({});
      await expect(client.commentOnPR("owner/repo", 5, "hi")).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 5,
        body: "hi",
      });
    });

    it("wraps failures with the PR number in context", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));
      await expect(client.commentOnPR("owner/repo", 5, "hi")).rejects.toThrow(
        'GitHub commentOnPR failed for "owner/repo" {"prNumber":5}: forbidden',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("owner/repo", 9)).resolves.toBe("diff --git a b");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 9,
        mediaType: { format: "diff" },
      });
    });

    it("wraps failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("owner/repo", 9)).rejects.toThrow(
        'GitHub getPRDiff failed for "owner/repo" {"prNumber":9}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when the PR is not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node1" } });
      await client.markPRReady("owner/repo", 3);
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 3);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node1",
      });
    });

    it("wraps a failure fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("gone"));
      await expect(client.markPRReady("owner/repo", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo" {"prNumber":3}: gone',
      );
    });

    it("wraps a failure from the graphql mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql exploded"));

      await expect(client.markPRReady("owner/repo", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo" {"prNumber":3}: graphql exploded',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hello", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("owner/repo", 4);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps failures", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("owner/repo", 4)).rejects.toThrow(
        'GitHub listPRComments failed for "owner/repo" {"prNumber":4}: boom',
      );
    });
  });

  describe("createPRReviewComment", () => {
    beforeEach(() => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "commit-sha" } } });
    });

    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 10);

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "commit-sha",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 10);

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-sha",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 1, path: "src/a.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("propagates a non-422 line-level error as a wrapped error", async () => {
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("weird failure"));

      await expect(
        client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 503 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts");

      expect(id).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "commit-sha",
      });
    });

    it("returns 0 and logs a warning when the file-level comment gets a 422", async () => {
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 1, path: "src/a.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("returns 0 when fetching the PR itself fails with 422", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 5);

      expect(id).toBe(0);
    });

    it("wraps a non-422 failure fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("pr fetch failed"));

      await expect(
        client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 5),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await expect(
        client.replyToReviewComment("owner/repo", 1, 501, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows failures and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("locked"));

      await expect(
        client.replyToReviewComment("owner/repo", 1, 501, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 1, commentId: 501, error: "locked" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits the review on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("owner/repo", 1, "lgtm", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because it's the author's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "please fix",
        event: "COMMENT",
      });
    });

    it("does not fall back when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("owner/repo", 1, "note", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });

    it("throws a wrapped error for an unrelated failure", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(
        client.submitPRReview("owner/repo", 1, "lgtm", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo" {"prNumber":1,"event":"APPROVE"}: service unavailable',
      );
    });
  });
});
