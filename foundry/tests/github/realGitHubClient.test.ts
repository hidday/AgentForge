import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeOctokit() {
  return {
    repos: { get: vi.fn() },
    git: { getRef: vi.fn(), createRef: vi.fn() },
    pulls: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      createReviewComment: vi.fn(),
      createReplyForReviewComment: vi.fn(),
      createReview: vi.fn(),
    },
    issues: { createComment: vi.fn(), listComments: vi.fn() },
    graphql: vi.fn(),
  };
}

type FakeOctokit = ReturnType<typeof makeOctokit>;

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("token", logger as never);
  const octokit = makeOctokit();
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

describe("RealGitHubClient", () => {
  describe("repo splitting", () => {
    it("rejects a repo string with no slash", async () => {
      const { client } = makeClient();
      await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
    });

    it("rejects a repo string with a leading slash (empty owner)", async () => {
      const { client } = makeClient();
      await expect(client.getDefaultBranch("/repo-with-no-owner")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the octokit call succeeds", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
    });

    it("wraps the underlying error with repo access guidance", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /cannot access repo "acme\/repo".*Not Found/s,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name from the repo payload", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
    });

    it("wraps errors with the operation name", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("boom"));
      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/repo".*boom/s,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

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
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success and does not throw", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue({ status: 422 });

      await expect(client.createBranch("acme/repo", "ai/feature-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("rethrows non-422 errors wrapped with context", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue({ status: 500, message: "server error" });

      await expect(client.createBranch("acme/repo", "ai/feature-1")).rejects.toThrow(
        /GitHub createBranch failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the created PR number on success", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field validation failure", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(
        Object.assign(new Error('Validation Failed: {"code":"missing_field"}'), { status: 422 }),
      );

      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("on a non-field 422, looks up and returns the existing open PR for the head branch", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue({ status: 422, message: "A pull request already exists" });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "acme:head",
        base: "main",
        state: "open",
      });
    });

    it("on a non-field 422 with no existing PR found, throws a wrapped error", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue({ status: 422, message: "A pull request already exists" });
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/repo", 5, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        issue_number: 5,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("acme/repo", 5, "hello")).rejects.toThrow(
        /commentOnPR failed.*rate limited/s,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff payload as a string", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/repo", 5)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/repo", 5)).rejects.toThrow(/getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false } });

      await client.markPRReady("acme/repo", 5);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when draft", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/repo", 5);

      expect(octokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "node-1" },
      );
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.markPRReady("acme/repo", 5)).rejects.toThrow(/markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps octokit comments to the PRComment shape, defaulting missing fields", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "nice", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/repo", 5);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "nice", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("acme/repo", 5)).rejects.toThrow(/listPRComments failed/);
    });
  });

  describe("createPRReviewComment", () => {
    it("posts a line-level comment when a line is provided", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 55 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "body", "src/x.ts", 10);

      expect(id).toBe(55);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src/x.ts", line: 10, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce({ status: 422 })
        .mockResolvedValueOnce({ data: { id: 56 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "body", "src/x.ts", 10);

      expect(id).toBe(56);
      expect(logger.warn).toHaveBeenCalled();
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject_type: "file", body: "*(line 10)* body" }),
      );
    });

    it("posts a file-level comment directly when no line is given", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 57 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "body", "src/x.ts");

      expect(id).toBe(57);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file" }),
      );
    });

    it("returns 0 and logs a warning when the outer call hits a 422 it cannot recover from", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockRejectedValue({ status: 422 });

      const id = await client.createPRReviewComment("acme/repo", 5, "body", "src/x.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 error from the line-level comment attempt", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/repo", 5, "body", "src/x.ts", 10),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/repo", 5, 1000, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1000, body: "thanks" }),
      );
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("boom"));

      await expect(
        client.replyToReviewComment("acme/repo", 5, 1000, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/repo", 5, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ body: "LGTM", event: "APPROVE" }),
      );
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the PR author", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/repo", 5, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: "COMMENT" }),
      );
    });

    it("never attempts the own-PR COMMENT fallback when the event is already COMMENT", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/repo", 5, "Just a note", "COMMENT"),
      ).rejects.toThrow(/submitPRReview/);

      // event is already "COMMENT", so the `event !== "COMMENT"` guard short-circuits
      // the fallback regardless of the error message, and createReview is called once.
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("rethrows other errors wrapped with context", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.submitPRReview("acme/repo", 5, "LGTM", "APPROVE"),
      ).rejects.toThrow(/submitPRReview failed/);
    });
  });
});
