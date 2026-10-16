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
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    const built = makeClient();
    client = built.client;
    octokit = built.octokit;
    logger = built.logger;
  });

  describe("repo format validation", () => {
    it("rejects with an 'Invalid repo format' error when the repo has no owner/name split", async () => {
      await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("throws a descriptive, cause-preserving error when the Octokit call fails", async () => {
      const original = new Error("Not Found");
      octokit.repos.get.mockRejectedValue(original);

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toMatchObject({
        message: expect.stringContaining(
          'GitHub: cannot access repo "acme/widgets". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
        ) as unknown as string,
        cause: original,
      });
    });

    it("stringifies a non-Error rejection instead of reading .message", async () => {
      octokit.repos.get.mockRejectedValue("just a plain string rejection");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        "Original: just a plain string rejection",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      const result = await client.getDefaultBranch("acme/widgets");

      expect(result).toBe("develop");
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
    });

    it("wraps the Octokit error with operation context", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": boom',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's current sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

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
        sha: "sha-123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 error with branchName context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("acme/widgets", "feature/x")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets" {"branchName":"feature/x"}: network error',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const result = await client.createDraftPR(
        "acme/widgets",
        "feature/x",
        "main",
        "My title",
        "My body",
      );

      expect(result).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "feature/x",
        base: "main",
        title: "My title",
        body: "My body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"message":"Validation Failed","errors":[{"code":"invalid"}]}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "no-such-base", "t", "b"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(logger.error).toHaveBeenCalledWith(
        { repo: "acme/widgets", head: "feature/x", base: "no-such-base", detail: expect.any(String) as unknown as string },
        "PR creation failed: invalid field (base branch may not exist)",
      );
    });

    it("returns the existing open PR's number on a 422 duplicate-PR failure", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR("acme/widgets", "feature/x", "main", "t", "b");

      expect(result).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:feature/x",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error on 422 duplicate-PR failure when no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "t", "b"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("throws a wrapped error on a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "t", "b"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets" {"head":"feature/x","base":"main"}: rate limited');
    });

    it("stringifies a non-Error 422 rejection when deciding if it's a field-validation error", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const result = await client.createDraftPR("acme/widgets", "feature/x", "main", "t", "b");

      expect(result).toBe(88);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("treats a '\"code\":\"missing_field\"' message as field validation too", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"message":"Validation Failed","errors":[{"code":"missing_field"}]}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "t", "b"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "acme/widgets" }),
        "PR creation failed: invalid field (base branch may not exist)",
      );
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on the PR", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("acme/widgets", 5, "hello world");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 5,
        body: "hello world",
      });
    });

    it("wraps the error with prNumber context on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("acme/widgets", 5, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":5}: boom',
      );
    });

    it("stringifies a non-Error rejection in the wrapped message", async () => {
      octokit.issues.createComment.mockRejectedValue({ weird: "object" });

      await expect(client.commentOnPR("acme/widgets", 5, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":5}: [object Object]',
      );
    });
  });

  describe("getPRDiff", () => {
    it("requests the diff media type and returns the raw diff text", async () => {
      const diffText = "diff --git a/foo b/foo\n+added line\n";
      octokit.pulls.get.mockResolvedValue({ data: diffText });

      const result = await client.getPRDiff("acme/widgets", 9);

      expect(result).toBe(diffText);
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 9,
        mediaType: { format: "diff" },
      });
    });

    it("wraps the error with prNumber context on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.getPRDiff("acme/widgets", 9)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/widgets" {"prNumber":9}: boom',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR as ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node_1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 3);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_node_1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 3 },
        "Marked PR as ready for review",
      );
    });

    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_node_1" } });

      await client.markPRReady("acme/widgets", 3);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps the error when fetching the PR fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("acme/widgets", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":3}: boom',
      );
    });

    it("wraps the error when the GraphQL mutation fails", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node_1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql boom"));

      await expect(client.markPRReady("acme/widgets", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":3}: graphql boom',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps Octokit comments onto the PRComment shape", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 111,
            user: { login: "alice" },
            body: "looks good",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const result = await client.listPRComments("acme/widgets", 4);

      expect(result).toEqual([
        { id: "111", author: "alice", body: "looks good", createdAt: "2024-01-01T00:00:00Z" },
      ]);
    });

    it("defaults author to 'unknown' and body to '' when missing", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 222,
            user: null,
            body: null,
            created_at: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const result = await client.listPRComments("acme/widgets", 4);

      expect(result).toEqual([
        { id: "222", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("returns an empty array when there are no comments", async () => {
      octokit.issues.listComments.mockResolvedValue({ data: [] });

      const result = await client.listPRComments("acme/widgets", 4);

      expect(result).toEqual([]);
    });

    it("wraps the error with prNumber context on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 4)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/widgets" {"prNumber":4}: boom',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment using the PR head sha", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        12,
        "nit: rename this",
        "src/foo.ts",
        10,
      );

      expect(result).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        body: "nit: rename this",
        path: "src/foo.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "head-sha",
      });
    });

    it("treats line 0 as provided (uses line-level path, not the no-line path)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 777 } });

      await client.createPRReviewComment("acme/widgets", 12, "body", "src/foo.ts", 0);

      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ line: 0, side: "RIGHT" }),
      );
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        12,
        "nit: rename this",
        "src/foo.ts",
        10,
      );

      expect(result).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        body: "*(line 10)* nit: rename this",
        path: "src/foo.ts",
        subject_type: "file",
        commit_id: "head-sha",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 12, path: "src/foo.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 503 } });

      const result = await client.createPRReviewComment(
        "acme/widgets",
        12,
        "general comment",
        "src/foo.ts",
      );

      expect(result).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        body: "general comment",
        path: "src/foo.ts",
        subject_type: "file",
        commit_id: "head-sha",
      });
    });

    it("returns 0 and logs a warning when the file is not in the diff (422) and no line was given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "file not in diff"));

      const result = await client.createPRReviewComment(
        "acme/widgets",
        12,
        "general comment",
        "src/foo.ts",
      );

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 12, path: "src/foo.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("rethrows a non-422 error from the line-level attempt and wraps it", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "head-sha" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createPRReviewComment("acme/widgets", 12, "body", "src/foo.ts", 10),
      ).rejects.toThrow(
        'GitHub createPRReviewComment failed for "acme/widgets" {"prNumber":12,"path":"src/foo.ts","line":10}: server exploded',
      );
    });

    it("wraps a non-422 error when fetching the PR fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("acme/widgets", 12, "body", "src/foo.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to the given review comment", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("acme/widgets", 12, 900, "thanks, fixed");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        comment_id: 900,
        body: "thanks, fixed",
      });
    });

    it("swallows the error and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/widgets", 12, 900, "thanks, fixed"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 12, commentId: 900, error: "comment deleted" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("deleted upstream");

      await expect(
        client.replyToReviewComment("acme/widgets", 12, 900, "thanks, fixed"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 12, commentId: 900, error: "deleted upstream" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event and body", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("acme/widgets", 12, "ship it", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        body: "ship it",
        event: "APPROVE",
      });
    });

    it("falls back to a COMMENT review when REQUEST_CHANGES fails on the author's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(httpError(422, "Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("acme/widgets", 12, "please fix", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 12,
        body: "please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 12, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("throws a wrapped error when the own-PR failure happens for an already-COMMENT event", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        httpError(422, "Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 12, "fyi", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets" {"prNumber":12,"event":"COMMENT"}');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error for an unrelated failure", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("acme/widgets", 12, "ship it", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":12,"event":"APPROVE"}: rate limited',
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error rejection when wrapping the error", async () => {
      octokit.pulls.createReview.mockRejectedValue(42);

      await expect(
        client.submitPRReview("acme/widgets", 12, "ship it", "APPROVE"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets" {"prNumber":12,"event":"APPROVE"}: 42');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
