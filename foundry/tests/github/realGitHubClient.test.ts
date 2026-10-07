import { describe, it, expect, vi, beforeEach } from "vitest";

const octokitInstance = {
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

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => octokitInstance),
}));

const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeClient() {
  return new RealGitHubClient("token-123", makeLogger() as never);
}

describe("RealGitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyRepoAccess", () => {
    it("resolves when repos.get succeeds", async () => {
      octokitInstance.repos.get.mockResolvedValue({ data: {} });
      const client = makeClient();
      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokitInstance.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("throws a descriptive error when the repo format is invalid", async () => {
      const client = makeClient();
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        'Invalid repo format "not-a-repo", expected "owner/repo"',
      );
    });

    it("wraps the underlying error with repo access guidance on failure", async () => {
      octokitInstance.repos.get.mockRejectedValue(new Error("404 Not Found"));
      const client = makeClient();
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*404 Not Found/,
      );
    });

    it("stringifies non-Error rejections", async () => {
      octokitInstance.repos.get.mockRejectedValue("boom");
      const client = makeClient();
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(/boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch from the repo data", async () => {
      octokitInstance.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      const client = makeClient();
      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name", async () => {
      octokitInstance.repos.get.mockRejectedValue(new Error("rate limited"));
      const client = makeClient();
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*rate limited/,
      );
    });

    it("stringifies a non-Error rejection when wrapping", async () => {
      octokitInstance.repos.get.mockRejectedValue({ weird: "object" });
      const client = makeClient();
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(/\[object Object\]/);
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch sha", async () => {
      octokitInstance.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitInstance.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokitInstance.git.createRef.mockResolvedValue({ data: {} });

      const client = makeClient();
      await client.createBranch("org/repo", "ai/issue-1");

      expect(octokitInstance.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokitInstance.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/issue-1",
        sha: "sha123",
      });
    });

    it("swallows a 422 (branch already exists) and logs instead of throwing", async () => {
      octokitInstance.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitInstance.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      const err = Object.assign(new Error("Reference already exists"), { status: 422 });
      octokitInstance.git.createRef.mockRejectedValue(err);

      const client = makeClient();
      await expect(client.createBranch("org/repo", "ai/issue-1")).resolves.toBeUndefined();
    });

    it("rethrows wrapped error for non-422 failures", async () => {
      octokitInstance.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitInstance.git.getRef.mockRejectedValue(new Error("not found"));

      const client = makeClient();
      await expect(client.createBranch("org/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo"/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokitInstance.pulls.create.mockResolvedValue({ data: { number: 42 } });
      const client = makeClient();
      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");
      expect(prNumber).toBe(42);
      expect(octokitInstance.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error for a 422 field-validation failure", async () => {
      const err = Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 });
      octokitInstance.pulls.create.mockRejectedValue(err);

      const client = makeClient();
      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokitInstance.pulls.create.mockRejectedValue(err);
      octokitInstance.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const client = makeClient();
      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(77);
      expect(octokitInstance.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 'already exists' error has no matching open PR", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokitInstance.pulls.create.mockRejectedValue(err);
      octokitInstance.pulls.list.mockResolvedValue({ data: [] });

      const client = makeClient();
      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      octokitInstance.pulls.create.mockRejectedValue(new Error("server error"));
      const client = makeClient();
      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("treats a non-Error 422 rejection as not field-validation and looks up the existing PR", async () => {
      octokitInstance.pulls.create.mockRejectedValue({ status: 422 });
      octokitInstance.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const client = makeClient();
      const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokitInstance.issues.createComment.mockResolvedValue({ data: {} });
      const client = makeClient();
      await client.commentOnPR("org/repo", 10, "hello");
      expect(octokitInstance.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      octokitInstance.issues.createComment.mockRejectedValue(new Error("403 Forbidden"));
      const client = makeClient();
      await expect(client.commentOnPR("org/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*403 Forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      const client = makeClient();
      await expect(client.getPRDiff("org/repo", 10)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokitInstance.pulls.get.mockRejectedValue(new Error("not found"));
      const client = makeClient();
      await expect(client.getPRDiff("org/repo", 10)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "n1" } });
      const client = makeClient();
      await client.markPRReady("org/repo", 10);
      expect(octokitInstance.graphql).not.toHaveBeenCalled();
    });

    it("issues the graphql mutation when the PR is a draft", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "n1" } });
      octokitInstance.graphql.mockResolvedValue({});
      const client = makeClient();
      await client.markPRReady("org/repo", 10);
      expect(octokitInstance.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "n1",
      });
    });

    it("wraps errors", async () => {
      octokitInstance.pulls.get.mockRejectedValue(new Error("auth failure"));
      const client = makeClient();
      await expect(client.markPRReady("org/repo", 10)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments and defaults missing fields", async () => {
      octokitInstance.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "hi",
            created_at: "2024-01-01T00:00:00Z",
          },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });
      const client = makeClient();
      const comments = await client.listPRComments("org/repo", 10);
      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokitInstance.issues.listComments.mockRejectedValue(new Error("rate limit exceeded"));
      const client = makeClient();
      await expect(client.listPRComments("org/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitInstance.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const client = makeClient();
      const commentId = await client.createPRReviewComment(
        "org/repo",
        10,
        "body",
        "src/f.ts",
        5,
      );

      expect(commentId).toBe(555);
      expect(octokitInstance.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/f.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when line is omitted", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitInstance.pulls.createReviewComment.mockResolvedValue({ data: { id: 556 } });

      const client = makeClient();
      const commentId = await client.createPRReviewComment("org/repo", 10, "body", "src/f.ts");

      expect(commentId).toBe(556);
      expect(octokitInstance.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/f.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      const lineErr = Object.assign(new Error("line not in diff"), { status: 422 });
      octokitInstance.pulls.createReviewComment
        .mockRejectedValueOnce(lineErr)
        .mockResolvedValueOnce({ data: { id: 557 } });

      const client = makeClient();
      const commentId = await client.createPRReviewComment(
        "org/repo",
        10,
        "body",
        "src/f.ts",
        5,
      );

      expect(commentId).toBe(557);
      expect(octokitInstance.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* body",
        path: "src/f.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("rethrows a non-422 line-level error up to the outer catch and wraps it", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitInstance.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      const client = makeClient();
      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/f.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("returns 0 and swallows a top-level 422 (e.g. file not in diff on a file-level comment)", async () => {
      octokitInstance.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      const err = Object.assign(new Error("file not in diff"), { status: 422 });
      octokitInstance.pulls.createReviewComment.mockRejectedValue(err);

      const client = makeClient();
      const commentId = await client.createPRReviewComment("org/repo", 10, "body", "src/f.ts");

      expect(commentId).toBe(0);
    });

    it("wraps a non-422 error from the initial pulls.get lookup", async () => {
      octokitInstance.pulls.get.mockRejectedValue(new Error("not found"));
      const client = makeClient();
      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/f.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokitInstance.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
      const client = makeClient();
      await client.replyToReviewComment("org/repo", 10, 555, "reply");
      expect(octokitInstance.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        comment_id: 555,
        body: "reply",
      });
    });

    it("logs a warning and does not throw when the reply fails", async () => {
      octokitInstance.pulls.createReplyForReviewComment.mockRejectedValue(
        new Error("comment deleted"),
      );
      const client = makeClient();
      await expect(
        client.replyToReviewComment("org/repo", 10, 555, "reply"),
      ).resolves.toBeUndefined();
    });

    it("stringifies a non-Error rejection in the warning log and does not throw", async () => {
      octokitInstance.pulls.createReplyForReviewComment.mockRejectedValue("plain string error");
      const client = makeClient();
      await expect(
        client.replyToReviewComment("org/repo", 10, 555, "reply"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokitInstance.pulls.createReview.mockResolvedValue({ data: {} });
      const client = makeClient();
      await client.submitPRReview("org/repo", 10, "LGTM", "APPROVE");
      expect(octokitInstance.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokitInstance.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      const client = makeClient();
      await client.submitPRReview("org/repo", 10, "Needs work", "REQUEST_CHANGES");

      expect(octokitInstance.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "Needs work",
        event: "COMMENT",
      });
    });

    it("wraps other errors instead of falling back", async () => {
      octokitInstance.pulls.createReview.mockRejectedValue(new Error("rate limited"));
      const client = makeClient();
      await expect(
        client.submitPRReview("org/repo", 10, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps the 'own PR' error when the event is already COMMENT", async () => {
      octokitInstance.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      const client = makeClient();
      await expect(
        client.submitPRReview("org/repo", 10, "Just noting", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps a non-Error rejection instead of matching the own-PR fallback regex", async () => {
      octokitInstance.pulls.createReview.mockRejectedValue({ weird: "object" });
      const client = makeClient();
      await expect(
        client.submitPRReview("org/repo", 10, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });
  });
});
