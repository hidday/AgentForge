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

function injectOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    octokit = makeFakeOctokit();
    injectOctokit(client, octokit);
  });

  describe("splitRepo validation", () => {
    it("rejects a repo string with no slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error with the original message when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /cannot access repo "acme\/repo".*Original: Not Found/,
      );
    });

    it("stringifies non-Error rejections in the wrapped message", async () => {
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(/Original: boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from the API response", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("develop");
    });

    it("throws a wrapped error when the API call fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limit exceeded"));

      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/repo".*rate limit exceeded/,
      );
    });

    it("stringifies a non-Error rejection in the wrapped message", async () => {
      octokit.repos.get.mockRejectedValue({ weird: "rejection" });

      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed.*\[object Object\]/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch's HEAD sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("acme/repo", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "refs/heads/ai/issue-1",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/repo", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error for non-422 failures", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("acme/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/repo".*network down/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR(
        "acme/repo",
        "feature",
        "main",
        "My title",
        "My body",
      );

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "feature",
        base: "main",
        title: "My title",
        body: "My body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/repo", "feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 missing_field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("acme/repo", "feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("falls back to the existing open PR when one already exists for the head branch", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/repo",
        "feature",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "acme:feature",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error when a 422 'already exists' has no matching open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/repo", "feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws a wrapped error for non-422 failures", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("acme/repo", "feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*network down/);
    });

    it("treats a non-Error 422 rejection as a non-field-validation 'already exists' case", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const prNumber = await client.createDraftPR(
        "acme/repo",
        "feature",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(88);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on the PR", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("acme/repo", 10, "Nice work");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        issue_number: 10,
        body: "Nice work",
      });
    });

    it("throws a wrapped error when commenting fails", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));

      await expect(client.commentOnPR("acme/repo", 10, "Nice work")).rejects.toThrow(
        /GitHub commentOnPR failed.*forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff data from the API", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/repo", 10)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("throws a wrapped error when fetching the diff fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/repo", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR as ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/repo", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.any(String), { prId: "node-1" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error when the API call fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("acme/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed.*boom/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps API comments into PRComment shape", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "Looks good",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const comments = await client.listPRComments("acme/repo", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "Looks good", createdAt: "2024-01-01T00:00:00Z" },
      ]);
    });

    it("defaults author to 'unknown' and body to '' when missing", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [{ id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" }],
      });

      const comments = await client.listPRComments("acme/repo", 10);

      expect(comments).toEqual([
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("throws a wrapped error when listing comments fails", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed.*boom/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const commentId = await client.createPRReviewComment(
        "acme/repo",
        10,
        "Fix this",
        "src/a.ts",
        5,
      );

      expect(commentId).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        body: "Fix this",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 501 } });

      const commentId = await client.createPRReviewComment(
        "acme/repo",
        10,
        "Fix this",
        "src/a.ts",
        5,
      );

      expect(commentId).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* Fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const commentId = await client.createPRReviewComment(
        "acme/repo",
        10,
        "General note",
        "src/a.ts",
      );

      expect(commentId).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        body: "General note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the outer call 422s (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422, "file not in diff"));

      const commentId = await client.createPRReviewComment(
        "acme/repo",
        10,
        "General note",
        "src/missing.ts",
      );

      expect(commentId).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows non-422 line-level errors instead of falling back", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("acme/repo", 10, "Fix this", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*network down/);
    });

    it("throws a wrapped error for non-422 outer failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/repo", 10, "General note", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to a review comment", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("acme/repo", 10, 500, "Thanks!");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        comment_id: 500,
        body: "Thanks!",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/repo", 10, 500, "Thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string rejection");

      await expect(
        client.replyToReviewComment("acme/repo", 10, 500, "Thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string rejection" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("acme/repo", 10, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("acme/repo", 10, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 10,
        body: "Needs work",
        event: "COMMENT",
      });
    });

    it("does not fall back for COMMENT events even on a matching error message", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("acme/repo", 10, "Note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error for unrelated failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(client.submitPRReview("acme/repo", 10, "LGTM", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*rate limited/,
      );
    });

    it("stringifies a non-Error rejection when checking for the own-PR fallback", async () => {
      octokit.pulls.createReview.mockRejectedValue({ status: 500 });

      await expect(
        client.submitPRReview("acme/repo", 10, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*\[object Object\]/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
