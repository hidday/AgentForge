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

function apiError(message: string, status?: number): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  if (status !== undefined) err.status = status;
  return err;
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

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeFakeOctokit();
  // Inject a fake Octokit SDK instance in place of the real one.
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, octokit, logger } = makeClient());
  });

  describe("repo format validation (splitRepo)", () => {
    it("rejects with an unwrapped error when repo has no slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with a permissions hint", async () => {
      octokit.repos.get.mockRejectedValue(apiError("Not Found", 404));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Not Found/s,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(/boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      const branch = await client.getDefaultBranch("acme/widgets");

      expect(branch).toBe("develop");
    });

    it("throws a wrapped error on failure", async () => {
      octokit.repos.get.mockRejectedValue(apiError("rate limited", 403));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*rate limited/s,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("acme/widgets", "feature/foo");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/feature/foo",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows a 422 (branch already exists) and logs info", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(apiError("Reference already exists", 422));

      await expect(client.createBranch("acme/widgets", "feature/foo")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error for non-422 failures", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(apiError("server error", 500));

      await expect(client.createBranch("acme/widgets", "feature/foo")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets".*feature\/foo/s,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "feature/foo",
        "main",
        "Add foo",
        "body",
      );

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "feature/foo",
        base: "main",
        title: "Add foo",
        body: "body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        apiError('Validation Failed: {"code":"invalid","field":"base"}', 422),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/foo", "nonexistent-base", "t", "b"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 missing_field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        apiError('Validation Failed: {"code":"missing_field"}', 422),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/foo", "main", "t", "b"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      octokit.pulls.create.mockRejectedValue(apiError("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "feature/foo",
        "main",
        "t",
        "b",
      );

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:feature/foo",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error when the 422 lookup finds no existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(apiError("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/foo", "main", "t", "b"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws a wrapped error for non-422 failures", async () => {
      octokit.pulls.create.mockRejectedValue(apiError("server error", 500));

      await expect(
        client.createDraftPR("acme/widgets", "feature/foo", "main", "t", "b"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("stringifies a non-Error 422 rejection when checking for field-validation and when wrapping", async () => {
      // A plain object (not an Error instance) with a 422 status: the
      // field-validation message check and the final wrapError both fall
      // back to String(err) instead of err.message.
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/foo", "main", "t", "b"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*\[object Object\]/s);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("acme/widgets", 42, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 42,
        body: "hello",
      });
    });

    it("throws a wrapped error on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(apiError("nope", 500));

      await expect(client.commentOnPR("acme/widgets", 42, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      const diff = await client.getPRDiff("acme/widgets", 42);

      expect(diff).toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        mediaType: { format: "diff" },
      });
    });

    it("throws a wrapped error on failure", async () => {
      octokit.pulls.get.mockRejectedValue(apiError("not found", 404));

      await expect(client.getPRDiff("acme/widgets", 42)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when the PR is already not draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node1" } });

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error when the GraphQL mutation fails", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node1" } });
      octokit.graphql.mockRejectedValue(apiError("graphql error", 500));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });

    it("throws a wrapped error when fetching the PR fails", async () => {
      octokit.pulls.get.mockRejectedValue(apiError("not found", 404));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps API comments into PRComment, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "looks good",
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

      const comments = await client.listPRComments("acme/widgets", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "looks good", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("throws a wrapped error on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(apiError("server error", 500));

      await expect(client.listPRComments("acme/widgets", 42)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment when a line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "headsha" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "fix this",
        "src/a.ts",
        10,
      );

      expect(commentId).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "fix this",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "headsha",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "headsha" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(apiError("line not in diff", 422))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "fix this",
        "src/a.ts",
        10,
      );

      expect(commentId).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "*(line 10)* fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "headsha",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "headsha" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 503 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "general note",
        "src/b.ts",
      );

      expect(commentId).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "general note",
        path: "src/b.ts",
        subject_type: "file",
        commit_id: "headsha",
      });
    });

    it("re-throws a non-422 line-comment error so the outer catch wraps it", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "headsha" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(apiError("server error", 500));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "fix this", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("returns 0 and logs a warning when the top-level call fails with 422", async () => {
      octokit.pulls.get.mockRejectedValue(apiError("file not in diff", 422));

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "note",
        "src/missing.ts",
      );

      expect(commentId).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("throws a wrapped error when the top-level call fails with a non-422 status", async () => {
      octokit.pulls.get.mockRejectedValue(apiError("server error", 500));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "note", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("acme/widgets", 42, 501, "thanks, fixed");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        comment_id: 501,
        body: "thanks, fixed",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(apiError("comment gone", 404));

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("weird failure");

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "weird failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(apiError("Can not request changes on your own pull request", 422))
        .mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("acme/widgets", 42, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not fall back and throws when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        apiError("Can not request changes on your own pull request", 422),
      );

      await expect(
        client.submitPRReview("acme/widgets", 42, "just a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error for unrelated failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(apiError("server error", 500));

      await expect(
        client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("stringifies a non-Error rejection when checking for the own-PR fallback message", async () => {
      // A plain object (not an Error instance): the regex-match message
      // falls back to String(err) instead of err.message.
      octokit.pulls.createReview.mockRejectedValue({ status: 422 });

      await expect(
        client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*\[object Object\]/s);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
