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

type FakeOctokit = {
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

function installFakeOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
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
    installFakeOctokit(client, octokit);
  });

  describe("repo name parsing", () => {
    it("rejects a repo string with no slash", async () => {
      await expect(client.verifyRepoAccess("invalid-repo")).rejects.toThrow(
        'Invalid repo format "invalid-repo", expected "owner/repo"',
      );
    });

    it("rejects a repo string missing the repo segment", async () => {
      await expect(client.verifyRepoAccess("owner/")).rejects.toThrow(
        'Invalid repo format "owner/", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with actionable guidance when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*GITHUB_TOKEN.*Not Found/s,
      );
    });

    it("preserves the original error as the cause", async () => {
      const original = new Error("Not Found");
      octokit.repos.get.mockRejectedValue(original);

      try {
        await client.verifyRepoAccess("org/repo");
        expect.unreachable();
      } catch (err) {
        expect((err as Error & { cause?: unknown }).cause).toBe(original);
      }
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("some string failure");

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /some string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name and repo", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo": boom',
      );
    });

    it("stringifies a non-Error rejection when wrapping", async () => {
      octokit.repos.get.mockRejectedValue({ weird: "failure" });

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo": [object Object]',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's HEAD sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("org/repo", "ai/feature");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("org/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "org/repo", branchName: "ai/feature" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps non-422 errors", async () => {
      octokit.repos.get.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("org/repo", "ai/feature")).rejects.toThrow(
        'GitHub createBranch failed for "org/repo" {"branchName":"ai/feature"}: server error',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error for a 422 field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a duplicate-head 422", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });

      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(7);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error when the 422 is a duplicate-head but no existing PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
    });

    it("handles a non-Error 422 rejection by stringifying its message", async () => {
      const nonErrorRejection = { status: 422, toString: () => '{"code":"invalid"}' };
      octokit.pulls.create.mockRejectedValue(nonErrorRejection);

      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error for a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "org/repo" {"head":"head","base":"main"}: network down');
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on the PR's issue thread", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("org/repo", 42, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 42,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("org/repo", 42, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "org/repo" {"prNumber":42}: boom',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("org/repo", 42)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 42)).rejects.toThrow(
        'GitHub getPRDiff failed for "org/repo" {"prNumber":42}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("org/repo", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps an error from fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.markPRReady("org/repo", 42)).rejects.toThrow(
        'GitHub markPRReady failed for "org/repo" {"prNumber":42}: not found',
      );
    });

    it("wraps an error from the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("mutation failed"));

      await expect(client.markPRReady("org/repo", 42)).rejects.toThrow(
        'GitHub markPRReady failed for "org/repo" {"prNumber":42}: mutation failed',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments to the PRComment shape", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "Looks good",
            created_at: "2026-01-01T00:00:00Z",
          },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "Looks good", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("org/repo", 42)).rejects.toThrow(
        'GitHub listPRComments failed for "org/repo" {"prNumber":42}: boom',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment("org/repo", 42, "Fix this", "file.ts", 10);

      expect(id).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        body: "Fix this",
        path: "file.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha-1",
      });
    });

    it("creates a file-level comment when line is omitted", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 556 } });

      const id = await client.createPRReviewComment("org/repo", 42, "General note", "file.ts");

      expect(id).toBe(556);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        body: "General note",
        path: "file.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 557 } });

      const id = await client.createPRReviewComment("org/repo", 42, "Fix this", "file.ts", 10);

      expect(id).toBe(557);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        body: "*(line 10)* Fix this",
        path: "file.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 error raised while creating a line comment", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("org/repo", 42, "Fix this", "file.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo"/);
    });

    it("returns 0 and warns when the overall operation fails with a 422", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422, "file not in diff"));

      const id = await client.createPRReviewComment("org/repo", 42, "Fix this", "file.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 42, path: "file.ts", line: 10 },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 error from fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(
        client.createPRReviewComment("org/repo", 42, "Fix this", "file.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo"/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("org/repo", 42, 555, "Thanks!");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        comment_id: 555,
        body: "Thanks!",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("org/repo", 42, 555, "Thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 42, commentId: 555, error: "comment deleted" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");

      await client.replyToReviewComment("org/repo", 42, 555, "Thanks!");

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "org/repo", prNumber: 42, commentId: 555, error: "plain string failure" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("org/repo", 42, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 42,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the author", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("org/repo", 42, "Please fix", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 42,
        body: "Please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps the error when the failure is not the own-PR restriction", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("org/repo", 42, "Please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "org/repo"');
    });

    it("wraps the error for a COMMENT event even if the message mentions 'own'", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("cannot request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("org/repo", 42, "Note", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "org/repo"');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error rejection when it does not match the own-PR message", async () => {
      octokit.pulls.createReview.mockRejectedValue({
        toString: () => "rate limited by proxy",
      });

      await expect(
        client.submitPRReview("org/repo", 42, "Please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "org/repo"');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
