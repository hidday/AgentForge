import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOctokit, OctokitCtor } = vi.hoisted(() => {
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
  const OctokitCtor = vi.fn(() => mockOctokit);
  return { mockOctokit, OctokitCtor };
});

vi.mock("@octokit/rest", () => ({
  Octokit: OctokitCtor,
}));

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
  });

  it("constructs an Octokit instance with the provided auth token", () => {
    expect(OctokitCtor).toHaveBeenCalledWith({ auth: "test-token" });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();

      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo" },
        "Verified GitHub repo access",
      );
    });

    it("throws a wrapped, descriptive error when access fails", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("not found"));

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /cannot access repo "owner\/repo".*not found/,
      );
    });

    it("rejects synchronously for a malformed repo string", async () => {
      await expect(client.verifyRepoAccess("no-slash")).rejects.toThrow(
        'Invalid repo format "no-slash", expected "owner/repo"',
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps errors with operation context", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo".*rate limited/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockResolvedValue({});

      await client.createBranch("owner/repo", "feature-x");

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/feature-x",
        sha: "sha123",
      });
    });

    it("treats a 422 (branch already exists) as success and logs info", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("owner/repo", "feature-x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "feature-x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps and rethrows non-422 errors", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("owner/repo", "feature-x")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(55);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure", async () => {
      mockOctokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns the existing open PR number when one already exists for the head branch", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(77);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 is reported but no existing open PR is found", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on the PR", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("owner/repo", 10, "nice work");

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 10,
        body: "nice work",
      });
    });

    it("wraps errors with the PR number", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("nope"));

      await expect(client.commentOnPR("owner/repo", 10, "x")).rejects.toThrow(
        /GitHub commentOnPR failed for "owner\/repo".*10.*nope/s,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff payload as a string", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("owner/repo", 10)).resolves.toBe("diff --git a b");
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.getPRDiff("owner/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      mockOctokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 10);

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.any(String), { prId: "node-1" });
    });

    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("owner/repo", 10);

      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("fail"));

      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const result = await client.listPRComments("owner/repo", 10);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("owner/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment(
        "owner/repo",
        10,
        "issue here",
        "src/a.ts",
        7,
      );

      expect(id).toBe(555);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "issue here",
        path: "src/a.ts",
        line: 7,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 999 } });

      const id = await client.createPRReviewComment(
        "owner/repo",
        10,
        "issue here",
        "src/a.ts",
        7,
      );

      expect(id).toBe(999);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "*(line 7)* issue here",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 321 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "note", "src/b.ts");

      expect(id).toBe(321);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "note",
        path: "src/b.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("rethrows a non-422 error from the line-level attempt without falling back to file-level", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "issue here", "src/a.ts", 7),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(1);
    });

    it("returns 0 and logs a warning when the outer call ultimately 422s", async () => {
      mockOctokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("owner/repo", 10, "note", "src/b.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows non-422 errors wrapped", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "note", "src/b.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("owner/repo", 10, 555, "thanks");

      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        comment_id: 555,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("owner/repo", 10, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment gone" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("owner/repo", 10, "LGTM", "APPROVE");

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on one's own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("owner/repo", 10, "needs work", "REQUEST_CHANGES");

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(mockOctokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "needs work",
        event: "COMMENT",
      });
    });

    it("rethrows other errors wrapped, without a fallback attempt", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("totally unrelated failure"));

      await expect(
        client.submitPRReview("owner/repo", 10, "needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
