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

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeFakeOctokit();
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

describe("RealGitHubClient", () => {
  describe("repo format validation", () => {
    it("rejects a repo string without a slash before making any API call", async () => {
      const { client, octokit } = makeClient();
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("wraps the underlying error with a permission hint", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        'GitHub: cannot access repo "acme/widgets". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
      );
    });

    it("stringifies non-Error rejections", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        "Original: boom",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      const branch = await client.getDefaultBranch("acme/widgets");
      expect(branch).toBe("develop");
    });

    it("wraps errors with an operation-specific message", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("network down"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": network down',
      );
    });

    it("stringifies a non-Error rejection when wrapping", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      octokit.repos.get.mockRejectedValue({ weird: true });

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": [object Object]',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "feature/x");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/feature/x",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("treats a 422 (branch already exists) as success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      const err = Object.assign(new Error("Reference already exists"), { status: 422 });
      octokit.git.createRef.mockRejectedValue(err);

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("ref lookup failed"));

      await expect(client.createBranch("acme/widgets", "feature/x")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets" {"branchName":"feature/x"}: ref lookup failed',
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR("acme/widgets", "head", "main", "Title", "Body");

      expect(prNumber).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 42 },
        "Created draft PR on GitHub",
      );
    });

    it("throws a wrapped error on a 422 field validation failure", async () => {
      const { client, octokit, logger } = makeClient();
      const err = Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("acme/widgets", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(logger.error).toHaveBeenCalledWith(
        { repo: "acme/widgets", head: "head", base: "bad-base", detail: err.message },
        "PR creation failed: invalid field (base branch may not exist)",
      );
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a duplicate-head 422", async () => {
      const { client, octokit, logger } = makeClient();
      const err = Object.assign(new Error("A pull request already exists for acme:head."), {
        status: 422,
      });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });

      const prNumber = await client.createDraftPR("acme/widgets", "head", "main", "Title", "Body");

      expect(prNumber).toBe(7);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:head",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 7 },
        "Found existing open PR",
      );
    });

    it("wraps the error when a 422 duplicate lookup finds no open PR", async () => {
      const { client, octokit } = makeClient();
      const err = Object.assign(new Error("duplicate head ref"), { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("handles a non-Error 422 rejection by stringifying it before the field-validation check", async () => {
      const { client, octokit } = makeClient();
      // A non-Error rejection with a 422 status: `message` is derived via
      // String(err) rather than `.message`, and won't match the field-validation
      // substrings, so this falls through to the duplicate-PR lookup path.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(octokit.pulls.list).toHaveBeenCalled();
    });

    it("wraps non-422 errors directly", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets" {"head":"head","base":"main"}: rate limited');
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 5, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 5,
        body: "hello",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5 },
        "Commented on PR",
      );
    });

    it("wraps errors with the PR number as context", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.createComment.mockRejectedValue(new Error("403"));

      await expect(client.commentOnPR("acme/widgets", 5, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":5}: 403',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff payload", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      const diff = await client.getPRDiff("acme/widgets", 5);
      expect(diff).toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 5)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/widgets" {"prNumber":5}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 5);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via graphql", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 5);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5 },
        "Marked PR as ready for review",
      );
    });

    it("wraps errors from the get call", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("acme/widgets", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":5}: gone',
      );
    });

    it("wraps errors from the graphql call", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql failed"));

      await expect(client.markPRReady("acme/widgets", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":5}: graphql failed',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 5);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 5)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/widgets" {"prNumber":5}: boom',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 55 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        5,
        "body",
        "src/x.ts",
        10,
      );

      expect(commentId).toBe(55);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "body",
        path: "src/x.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha-1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, path: "src/x.ts", line: 10, commentId: 55 },
        "Created PR review comment",
      );
    });

    it("creates a file-level comment directly when no line is given", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 56 } });

      const commentId = await client.createPRReviewComment("acme/widgets", 5, "body", "src/x.ts");

      expect(commentId).toBe(56);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "body",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      const lineErr = Object.assign(new Error("line not in diff"), { status: 422 });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(lineErr)
        .mockResolvedValueOnce({ data: { id: 57 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        5,
        "body",
        "src/x.ts",
        10,
      );

      expect(commentId).toBe(57);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "*(line 10)* body",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, path: "src/x.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("rethrows a non-422 line-comment error, hits the outer catch, and rewraps it", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createPRReviewComment("acme/widgets", 5, "body", "src/x.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });

    it("returns 0 and warns when the outer call fails with a 422 (file not in diff)", async () => {
      const { client, octokit, logger } = makeClient();
      const err = Object.assign(new Error("no such file in diff"), { status: 422 });
      octokit.pulls.get.mockRejectedValue(err);

      const commentId = await client.createPRReviewComment("acme/widgets", 5, "body", "src/x.ts");

      expect(commentId).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, path: "src/x.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 error from fetching the PR", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("pr fetch failed"));

      await expect(
        client.createPRReviewComment("acme/widgets", 5, "body", "src/x.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 5, 99, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        comment_id: 99,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 99 },
        "Replied to PR review comment",
      );
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/widgets", 5, 99, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 99, error: "comment deleted" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the warning", async () => {
      const { client, octokit, logger } = makeClient();
      // eslint-disable-next-line @typescript-eslint/only-throw-error, prefer-promise-reject-errors
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string reason");

      await expect(
        client.replyToReviewComment("acme/widgets", 5, 99, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 99, error: "plain string reason" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 5, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "lgtm",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, event: "APPROVE" },
        "Submitted PR review",
      );
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 5, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("wraps the error when the event is already COMMENT (no fallback attempted)", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("acme/widgets", 5, "note", "COMMENT")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":5,"event":"COMMENT"}',
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps unrelated errors without attempting a fallback", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(client.submitPRReview("acme/widgets", 5, "note", "APPROVE")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":5,"event":"APPROVE"}: service unavailable',
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error rejection when checking for the own-PR fallback", async () => {
      const { client, octokit } = makeClient();
      // Not an Error instance and doesn't match the "own PR" pattern once
      // stringified, so it falls straight through to wrapError.
      // eslint-disable-next-line @typescript-eslint/only-throw-error, prefer-promise-reject-errors
      octokit.pulls.createReview.mockRejectedValue({ notAnError: true });

      await expect(client.submitPRReview("acme/widgets", 5, "note", "APPROVE")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":5,"event":"APPROVE"}: [object Object]',
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
