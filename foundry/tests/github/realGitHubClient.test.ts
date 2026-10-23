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

function makeFakeOctokit() {
  return {
    repos: {
      get: vi.fn(),
    },
    git: {
      getRef: vi.fn(),
      createRef: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      createReviewComment: vi.fn(),
      createReplyForReviewComment: vi.fn(),
      createReview: vi.fn(),
    },
    issues: {
      createComment: vi.fn(),
      listComments: vi.fn(),
    },
    graphql: vi.fn(),
  };
}

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function injectOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

describe("RealGitHubClient", () => {
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeFakeOctokit();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    injectOctokit(client, octokit);
  });

  describe("repo format validation", () => {
    it("rejects with a clear message when repo is missing a slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });

    it("rejects when repo has an empty owner or name segment", async () => {
      await expect(client.getDefaultBranch("/repo")).rejects.toThrow("Invalid repo format");
      await expect(client.getDefaultBranch("owner/")).rejects.toThrow("Invalid repo format");
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/backend-api")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "backend-api" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with a GITHUB_TOKEN hint on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/backend-api")).rejects.toThrow(
        /cannot access repo "acme\/backend-api".*GITHUB_TOKEN.*Not Found/s,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("acme/backend-api")).rejects.toThrow(
        /plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/backend-api")).resolves.toBe("develop");
    });

    it("wraps the error on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("acme/backend-api")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/backend-api": boom',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("acme/backend-api", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        ref: "refs/heads/ai/issue-1",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      const err = Object.assign(new Error("Reference already exists"), { status: 422 });
      octokit.git.createRef.mockRejectedValue(err);

      await expect(client.createBranch("acme/backend-api", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/backend-api", branchName: "ai/issue-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps non-422 errors", async () => {
      octokit.repos.get.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("acme/backend-api", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/backend-api".*network down/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR(
        "acme/backend-api",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        head: "ai/issue-1",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure", async () => {
      const err = Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("acme/backend-api", "ai/issue-1", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("recovers the existing open PR number on a 422 duplicate-head failure", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/backend-api",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        head: "acme:ai/issue-1",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error on a 422 duplicate-head failure when no existing PR is found", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/backend-api", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.createDraftPR("acme/backend-api", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*rate limited/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await expect(
        client.commentOnPR("acme/backend-api", 100, "Looks good"),
      ).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        issue_number: 100,
        body: "Looks good",
      });
    });

    it("wraps the error on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("403 Forbidden"));

      await expect(client.commentOnPR("acme/backend-api", 100, "hi")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/backend-api" {"prNumber":100}: 403 Forbidden',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x\n+added" });

      await expect(client.getPRDiff("acme/backend-api", 100)).resolves.toBe(
        "diff --git a/x b/x\n+added",
      );
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        mediaType: { format: "diff" },
      });
    });

    it("wraps the error on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/backend-api", 100)).rejects.toThrow(
        /GitHub getPRDiff failed/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/backend-api", 100);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via graphql", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/backend-api", 100);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("acme/backend-api", 100)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing user/body fields", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hello", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/backend-api", 100);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps the error on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/backend-api", 100)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment(
        "acme/backend-api",
        100,
        "Nit",
        "src/x.ts",
        12,
      );

      expect(id).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        body: "Nit",
        path: "src/x.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "sha-1",
      });
    });

    it("creates a file-level comment when no line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment(
        "acme/backend-api",
        100,
        "File-level note",
        "src/x.ts",
      );

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        body: "File-level note",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      const lineErr = Object.assign(new Error("line not in diff"), { status: 422 });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(lineErr)
        .mockResolvedValueOnce({ data: { id: 502 } });

      const id = await client.createPRReviewComment(
        "acme/backend-api",
        100,
        "Nit",
        "src/x.ts",
        12,
      );

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        body: "*(line 12)* Nit",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("re-throws and wraps a non-422 line-level error", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network error"));

      await expect(
        client.createPRReviewComment("acme/backend-api", 100, "Nit", "src/x.ts", 12),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("returns 0 and warns when the outer call fails with 422 (file not in diff)", async () => {
      const err = Object.assign(new Error("file not in diff"), { status: 422 });
      octokit.pulls.get.mockRejectedValue(err);

      const id = await client.createPRReviewComment("acme/backend-api", 100, "Nit", "src/x.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 outer error", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("acme/backend-api", 100, "Nit", "src/x.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(
        client.replyToReviewComment("acme/backend-api", 100, 500, "Fixed"),
      ).resolves.toBeUndefined();
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        comment_id: 500,
        body: "Fixed",
      });
    });

    it("swallows the error and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/backend-api", 100, 500, "Fixed"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await expect(
        client.submitPRReview("acme/backend-api", 100, "LGTM", "APPROVE"),
      ).resolves.toBeUndefined();
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on one's own PR", async () => {
      const err = new Error("GraphQL: Can not request changes on your own pull request");
      octokit.pulls.createReview.mockRejectedValueOnce(err).mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("acme/backend-api", 100, "Needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "backend-api",
        pull_number: 100,
        body: "Needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps the error when event is already COMMENT (no fallback possible)", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/backend-api", 100, "Note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps the error when the failure message does not match the own-PR pattern", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("acme/backend-api", 100, "Note", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*rate limited/);
    });
  });
});
