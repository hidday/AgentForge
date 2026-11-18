import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOctokit } = vi.hoisted(() => {
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
  return { mockOctokit };
});

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => mockOctokit),
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
  let client: RealGitHubClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
  });

  describe("repo format validation", () => {
    it("throws for a repo string without an owner/repo slash", async () => {
      await expect(client.verifyRepoAccess("not-valid")).rejects.toThrow(
        'Invalid repo format "not-valid", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
    });

    it("wraps the error with guidance when access fails", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /cannot access repo "acme\/repo".*GITHUB_TOKEN.*Not Found/s,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      mockOctokit.repos.get.mockRejectedValue("weird failure");
      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(/weird failure/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("develop");
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("network down"));
      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/repo".*network down/,
      );
    });

    it("stringifies a non-Error rejection in the wrapped message", async () => {
      mockOctokit.repos.get.mockRejectedValue("plain string failure");
      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /plain string failure/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch's sha", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("acme/repo", "ai/new-branch");

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "refs/heads/ai/new-branch",
        sha: "sha123",
      });
    });

    it("treats a 422 from createRef as 'branch already exists' and does not throw", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/repo", "ai/new-branch")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/repo", branchName: "ai/new-branch" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps and throws a non-422 error", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("acme/repo", "ai/new-branch")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/repo".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const num = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

      expect(num).toBe(7);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws on a non-422 error", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(500));
      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws a wrapped error for a 422 field-validation failure (code: invalid)", async () => {
      mockOctokit.pulls.create.mockRejectedValue(
        httpError(422, '{"message":"Validation Failed","errors":[{"code":"invalid"}]}'),
      );

      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error for a 422 field-validation failure (code: missing_field)", async () => {
      mockOctokit.pulls.create.mockRejectedValue(
        httpError(422, '{"message":"Validation Failed","errors":[{"code":"missing_field"}]}'),
      );

      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns the existing open PR when one already exists for the head branch", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const num = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

      expect(num).toBe(55);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "acme:head",
        base: "main",
        state: "open",
      });
    });

    it("treats a non-Error 422 rejection as the 'already exists' case (stringifies the message)", async () => {
      const nonErrorRejection = { status: 422, toString: () => "A pull request already exists" };
      mockOctokit.pulls.create.mockRejectedValue(nonErrorRejection);
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

      expect(num).toBe(77);
    });

    it("throws when a 422 'already exists' error has no matching open PR", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on the PR", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({});
      await client.commentOnPR("acme/repo", 1, "Nice work");
      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        issue_number: 1,
        body: "Nice work",
      });
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
      await expect(client.commentOnPR("acme/repo", 1, "Nice work")).rejects.toThrow(
        /GitHub commentOnPR failed.*rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a/a b/a" });
      await expect(client.getPRDiff("acme/repo", 1)).resolves.toBe("diff --git a/a b/a");
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("acme/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });
      await client.markPRReady("acme/repo", 1);
      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      mockOctokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/repo", 1);

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.markPRReady("acme/repo", 1)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments, falling back for missing author/body", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/repo", 1);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("throws a wrapped error on failure", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("acme/repo", 1)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment and returns its id", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 11 } });

      const id = await client.createPRReviewComment("acme/repo", 1, "Nit", "src/a.ts", 10);

      expect(id).toBe(11);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        body: "Nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 22 } });

      const id = await client.createPRReviewComment("acme/repo", 1, "Nit", "src/a.ts", 10);

      expect(id).toBe(22);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        body: "*(line 10)* Nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("rethrows a non-422 line-level error, wrapped by the outer catch", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValue(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("acme/repo", 1, "Nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/);
    });

    it("creates a file-level comment when no line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 33 } });

      const id = await client.createPRReviewComment("acme/repo", 1, "General note", "src/a.ts");

      expect(id).toBe(33);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        body: "General note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the outer call fails with 422", async () => {
      mockOctokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("acme/repo", 1, "Note", "src/a.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("throws a wrapped error when the outer call fails with a non-422 error", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("fatal"));

      await expect(
        client.createPRReviewComment("acme/repo", 1, "Note", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*fatal/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await client.replyToReviewComment("acme/repo", 1, 100, "Thanks");
      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        comment_id: 100,
        body: "Thanks",
      });
    });

    it("swallows the error and logs a warning instead of throwing", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));
      await expect(client.replyToReviewComment("acme/repo", 1, 100, "Thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "acme/repo", prNumber: 1, commentId: 100 }),
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the logged warning", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");
      await expect(client.replyToReviewComment("acme/repo", 1, 100, "Thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("acme/repo", 1, "LGTM", "APPROVE");
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub blocks requesting changes on your own PR", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/repo", 1, "Needs fixes", "REQUEST_CHANGES");

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(mockOctokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 1,
        body: "Needs fixes",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error for an unrelated failure", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("network error"));
      await expect(client.submitPRReview("acme/repo", 1, "Body", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*network error/,
      );
    });

    it("stringifies a non-Error rejection when checking for the own-PR message", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue("plain string failure");
      await expect(client.submitPRReview("acme/repo", 1, "Body", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*plain string failure/,
      );
    });

    it("throws (does not fall back) when the own-PR error occurs for a COMMENT event", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      await expect(client.submitPRReview("acme/repo", 1, "Body", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
