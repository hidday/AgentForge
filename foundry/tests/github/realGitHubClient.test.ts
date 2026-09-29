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

/** Builds an Error carrying an Octokit-style `status` field. */
function httpError(status: number, message = "request failed"): Error {
  return Object.assign(new Error(message), { status });
}

function makeOctokit() {
  return {
    repos: {
      get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
    },
    git: {
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "base-sha" } } }),
      createRef: vi.fn().mockResolvedValue({}),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({ data: { number: 42 } }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi
        .fn()
        .mockResolvedValue({ data: { draft: true, node_id: "pr-node-1", head: { sha: "head-sha" } } }),
      createReviewComment: vi.fn().mockResolvedValue({ data: { id: 555 } }),
      createReplyForReviewComment: vi.fn().mockResolvedValue({}),
      createReview: vi.fn().mockResolvedValue({}),
    },
    issues: {
      createComment: vi.fn().mockResolvedValue({}),
      listComments: vi.fn().mockResolvedValue({ data: [] }),
    },
    graphql: vi.fn().mockResolvedValue({}),
  };
}

type FakeOctokit = ReturnType<typeof makeOctokit>;

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeOctokit();
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

  describe("repo format validation", () => {
    it("throws on a repo string without a slash, before touching the network", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with a GITHUB_TOKEN hint", async () => {
      octokit.repos.get.mockRejectedValueOnce(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        'GitHub: cannot access repo "acme/repo". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
      );
    });

    it("sets Error.cause to the original error", async () => {
      const original = new Error("Not Found");
      octokit.repos.get.mockRejectedValueOnce(original);

      let caught: unknown;
      try {
        await client.verifyRepoAccess("acme/repo");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBe(original);
    });

    it("stringifies a non-Error rejection instead of reading .message", async () => {
      octokit.repos.get.mockRejectedValueOnce("plain string failure");

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        'Original: plain string failure',
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      octokit.repos.get.mockResolvedValueOnce({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("develop");
    });

    it("wraps errors with operation context", async () => {
      octokit.repos.get.mockRejectedValueOnce(new Error("boom"));
      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/repo": boom',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's HEAD sha", async () => {
      await client.createBranch("acme/repo", "ai/feature-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "refs/heads/ai/feature-1",
        sha: "base-sha",
      });
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      octokit.git.createRef.mockRejectedValueOnce(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/repo", "ai/feature-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/repo", branchName: "ai/feature-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps and throws non-422 errors with branchName context", async () => {
      octokit.git.createRef.mockRejectedValueOnce(httpError(500, "server error"));

      await expect(client.createBranch("acme/repo", "ai/feature-1")).rejects.toThrow(
        'GitHub createBranch failed for "acme/repo" {"branchName":"ai/feature-1"}: server error',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      const num = await client.createDraftPR("acme/repo", "ai/1", "main", "Title", "Body");
      expect(num).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "ai/1",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped field-validation error on 422 with invalid-field details", async () => {
      octokit.pulls.create.mockRejectedValueOnce(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(client.createDraftPR("acme/repo", "ai/1", "bad-base", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed for "acme\/repo"/,
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      octokit.pulls.create.mockRejectedValueOnce(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValueOnce({ data: [{ number: 7 }] });

      const num = await client.createDraftPR("acme/repo", "ai/1", "main", "T", "B");

      expect(num).toBe(7);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "acme:ai/1",
        base: "main",
        state: "open",
      });
    });

    it("throws when the 422 is not field validation and no existing PR is found", async () => {
      octokit.pulls.create.mockRejectedValueOnce(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValueOnce({ data: [] });

      await expect(client.createDraftPR("acme/repo", "ai/1", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed for "acme\/repo"/,
      );
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValueOnce(httpError(500, "server exploded"));

      await expect(client.createDraftPR("acme/repo", "ai/1", "main", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "acme/repo" {"head":"ai/1","base":"main"}: server exploded',
      );
    });

    it("stringifies a non-Error 422 rejection when checking for field-validation details", async () => {
      const nonError = { status: 422, toString: () => '{"code":"invalid","field":"base"}' };
      octokit.pulls.create.mockRejectedValueOnce(nonError);

      await expect(client.createDraftPR("acme/repo", "ai/1", "bad-base", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed for "acme\/repo"/,
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on the PR", async () => {
      await client.commentOnPR("acme/repo", 42, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        issue_number: 42,
        body: "hello",
      });
    });

    it("wraps errors with prNumber context", async () => {
      octokit.issues.createComment.mockRejectedValueOnce(new Error("nope"));
      await expect(client.commentOnPR("acme/repo", 42, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/repo" {"prNumber":42}: nope',
      );
    });

    it("wraps a non-Error rejection via String() in wrapError", async () => {
      octokit.issues.createComment.mockRejectedValueOnce("weird failure");
      await expect(client.commentOnPR("acme/repo", 42, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/repo" {"prNumber":42}: weird failure',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValueOnce({ data: "diff --git a/x b/x" });
      await expect(client.getPRDiff("acme/repo", 42)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors with prNumber context", async () => {
      octokit.pulls.get.mockRejectedValueOnce(new Error("not found"));
      await expect(client.getPRDiff("acme/repo", 42)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/repo" {"prNumber":42}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR as ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValueOnce({
        data: { draft: true, node_id: "node-abc" },
      });

      await client.markPRReady("acme/repo", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-abc",
      });
    });

    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValueOnce({ data: { draft: false, node_id: "node-abc" } });

      await client.markPRReady("acme/repo", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors with prNumber context", async () => {
      octokit.pulls.get.mockRejectedValueOnce(new Error("gone"));
      await expect(client.markPRReady("acme/repo", 42)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/repo" {"prNumber":42}: gone',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps GitHub comments to PRComment shape, defaulting missing fields", async () => {
      octokit.issues.listComments.mockResolvedValueOnce({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/repo", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors with prNumber context", async () => {
      octokit.issues.listComments.mockRejectedValueOnce(new Error("rate limited"));
      await expect(client.listPRComments("acme/repo", 42)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/repo" {"prNumber":42}: rate limited',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-anchored comment on the RIGHT side using the PR head sha", async () => {
      const id = await client.createPRReviewComment("acme/repo", 42, "nice", "src/a.ts", 10);

      expect(id).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        body: "nice",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "head-sha",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 777 } });

      const id = await client.createPRReviewComment("acme/repo", 42, "nice", "src/a.ts", 10);

      expect(id).toBe(777);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        body: "*(line 10)* nice",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "head-sha",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      await client.createPRReviewComment("acme/repo", 42, "nice", "src/a.ts");

      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        body: "nice",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "head-sha",
      });
    });

    it("returns 0 and warns when the outer call fails with 422 (file not in diff, no line)", async () => {
      octokit.pulls.createReviewComment.mockRejectedValueOnce(httpError(422, "file not in diff"));

      const id = await client.createPRReviewComment("acme/repo", 42, "nice", "src/missing.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 error from the line-based attempt, wrapped by the outer catch", async () => {
      octokit.pulls.createReviewComment.mockRejectedValueOnce(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("acme/repo", 42, "nice", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/repo"');
    });

    it("wraps a non-422 error thrown while fetching the PR (commit sha)", async () => {
      octokit.pulls.get.mockRejectedValueOnce(new Error("cannot fetch pr"));

      await expect(
        client.createPRReviewComment("acme/repo", 42, "nice", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/repo"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply to the given review comment", async () => {
      await client.replyToReviewComment("acme/repo", 42, 555, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        comment_id: 555,
        body: "thanks",
      });
    });

    it("logs a warning and does not throw when replying fails", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValueOnce(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/repo", 42, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValueOnce("comment gone");

      await expect(
        client.replyToReviewComment("acme/repo", 42, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment gone" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      await client.submitPRReview("acme/repo", 42, "Looks great", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        body: "Looks great",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for the author's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("acme/repo", 42, "Needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 42,
        body: "Needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws (does not fall back) when the own-PR error occurs for a COMMENT event", async () => {
      octokit.pulls.createReview.mockRejectedValueOnce(
        new Error("Cannot request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/repo", 42, "Note", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/repo"');
    });

    it("wraps unrelated errors", async () => {
      octokit.pulls.createReview.mockRejectedValueOnce(new Error("network down"));

      await expect(
        client.submitPRReview("acme/repo", 42, "Note", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/repo" {"prNumber":42,"event":"APPROVE"}: network down',
      );
    });

    it("stringifies a non-Error rejection when checking for the own-PR message", async () => {
      octokit.pulls.createReview.mockRejectedValueOnce("network down");

      await expect(
        client.submitPRReview("acme/repo", 42, "Note", "APPROVE"),
      ).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/repo" {"prNumber":42,"event":"APPROVE"}: network down',
      );
    });
  });
});
