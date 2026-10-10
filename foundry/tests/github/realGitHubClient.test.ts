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

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function withStatus(message: string, status: number): Error {
  const err = new Error(message);
  (err as unknown as { status: number }).status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;

  beforeEach(() => {
    client = new RealGitHubClient("test-token", makeLogger() as never);
    octokit = makeFakeOctokit();
    (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  });

  describe("splitRepo validation", () => {
    it("throws a clear error for a repo string with no slash", async () => {
      await expect(client.verifyRepoAccess("norepo")).rejects.toThrow(
        'Invalid repo format "norepo", expected "owner/repo"',
      );
    });

    it("throws a clear error for a repo string missing the repo part", async () => {
      await expect(client.verifyRepoAccess("owner/")).rejects.toThrow(
        'Invalid repo format "owner/", expected "owner/repo"',
      );
    });

    it("accepts a valid owner/repo string", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
    });
  });

  describe("verifyRepoAccess", () => {
    it("succeeds when repos.get resolves", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
    });

    it("wraps the error with a clear message on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("not found"));
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /GitHub: cannot access repo "owner\/repo".*Original: not found/,
      );
    });

    it("stringifies a non-Error thrown value in the wrapped message", async () => {
      octokit.repos.get.mockRejectedValue("a plain string failure");
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /Original: a plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps the error on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo".*boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch ref on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("owner/repo", "ai/feature");

      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "sha123",
      });
    });

    it("swallows the error and continues when the branch already exists (422)", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(withStatus("already exists", 422));

      await expect(client.createBranch("owner/repo", "ai/feature")).resolves.toBeUndefined();
    });

    it("rethrows a wrapped error for non-422 failures", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("owner/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo".*network error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(42);
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

    it("logs and rethrows on a 422 field-validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        withStatus('Validation failed: {"code":"invalid","field":"base"}', 422),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("logs and rethrows on a 422 missing_field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        withStatus('Validation failed: {"code":"missing_field"}', 422),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns the existing open PR's number on a 422 'already exists' error", async () => {
      octokit.pulls.create.mockRejectedValue(withStatus("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(99);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("rethrows when a 422 'already exists' error has no matching existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(withStatus("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps and rethrows non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*server error/);
    });

    it("handles a non-Error 422 thrown value by falling through to the existing-PR lookup", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(55);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });
      await expect(client.commentOnPR("owner/repo", 10, "hi")).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 10,
        body: "hi",
      });
    });

    it("wraps the error on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
      await expect(client.commentOnPR("owner/repo", 10, "hi")).rejects.toThrow(
        /GitHub commentOnPR failed.*rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("owner/repo", 10)).resolves.toBe("diff --git a b");
    });

    it("wraps the error on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("owner/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("is a no-op when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("owner/repo", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the graphql mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("wraps the error on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed.*boom/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, falling back to 'unknown' author when user is null", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: "anon comment", created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const result = await client.listPRComments("owner/repo", 10);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "anon comment", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps the error on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("owner/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed.*boom/,
      );
    });

    it("falls back to an empty string body when the comment body is null", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [{ id: 3, user: { login: "bob" }, body: null, created_at: "2026-01-03T00:00:00Z" }],
      });

      const result = await client.listPRComments("owner/repo", 10);

      expect(result).toEqual([
        { id: "3", author: "bob", body: "", createdAt: "2026-01-03T00:00:00Z" },
      ]);
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        10,
        "nit",
        "src/file.ts",
        42,
      );

      expect(result).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "nit",
        path: "src/file.ts",
        line: 42,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line comment fails with 422", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(withStatus("line not in diff", 422))
        .mockResolvedValueOnce({ data: { id: 777 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        10,
        "nit",
        "src/file.ts",
        42,
      );

      expect(result).toBe(777);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "*(line 42)* nit",
        path: "src/file.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment directly when no line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 888 } });

      const result = await client.createPRReviewComment("owner/repo", 10, "nit", "src/file.ts");

      expect(result).toBe(888);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "nit",
        path: "src/file.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 when the outer operation fails with 422 (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(withStatus("file not in diff", 422));

      const result = await client.createPRReviewComment("owner/repo", 10, "nit", "src/file.ts");

      expect(result).toBe(0);
    });

    it("rethrows a wrapped error for non-422 outer failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "nit", "src/file.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/);
    });

    it("rethrows a non-422 error from the line-comment attempt", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("other failure"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "nit", "src/file.ts", 42),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*other failure/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(
        client.replyToReviewComment("owner/repo", 10, 123, "reply"),
      ).resolves.toBeUndefined();
    });

    it("warns and does not rethrow on failure", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("boom"));

      await expect(
        client.replyToReviewComment("owner/repo", 10, 123, "reply"),
      ).resolves.toBeUndefined();
    });

    it("warns and does not rethrow when a non-Error value is thrown", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("a string failure");

      await expect(
        client.replyToReviewComment("owner/repo", 10, 123, "reply"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("owner/repo", 10, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("You can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("owner/repo", 10, "please fix", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "please fix",
        event: "COMMENT",
      });
    });

    it("rethrows a wrapped error for non-matching failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("some other error"));

      await expect(
        client.submitPRReview("owner/repo", 10, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*some other error/);
    });

    it("rethrows the 'own PR' error unchanged when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("You can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("owner/repo", 10, "a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps a non-Error thrown value", async () => {
      octokit.pulls.createReview.mockRejectedValue("a string failure");

      await expect(
        client.submitPRReview("owner/repo", 10, "a note", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*a string failure/);
    });
  });
});
