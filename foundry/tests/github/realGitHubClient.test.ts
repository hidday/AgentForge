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

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeFakeOctokit();
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;

  beforeEach(() => {
    ({ client, octokit } = makeClient());
  });

  describe("repo name parsing", () => {
    it("throws a descriptive error for a repo name without a slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format "not-a-valid-repo", expected "owner\/repo"/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
    });

    it("wraps the underlying error with repo-access guidance", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /cannot access repo "owner\/repo".*Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo".*rate limited/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("owner/repo", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/issue-1",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success and does not throw", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("owner/repo", "ai/issue-1")).resolves.toBeUndefined();
    });

    it("wraps a non-422 error", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("owner/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });
      const num = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");
      expect(num).toBe(7);
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

    it("throws on 422 field validation errors instead of looking up an existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"invalid","field":"base"}'),
      );
      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("returns the existing open PR number on a 422 'already exists' error", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const num = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");
      expect(num).toBe(55);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 occurs but no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps a non-422 error", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));
      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*network down/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment via the issues API", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });
      await client.commentOnPR("owner/repo", 1, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 1,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("403"));
      await expect(client.commentOnPR("owner/repo", 1, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "owner\/repo".*403/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("owner/repo", 3)).resolves.toBe("diff --git a b");
    });

    it("wraps errors with the PR number", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("owner/repo", 3)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false } });
      await client.markPRReady("owner/repo", 1);
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});
      await client.markPRReady("owner/repo", 1);
      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("gone"));
      await expect(client.markPRReady("owner/repo", 1)).rejects.toThrow(
        /GitHub markPRReady failed.*gone/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author to 'unknown' and missing body to ''", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });
      const comments = await client.listPRComments("owner/repo", 1);
      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("rate limit"));
      await expect(client.listPRComments("owner/repo", 1)).rejects.toThrow(
        /GitHub listPRComments failed.*rate limit/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates an inline comment when a line number is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 11 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 5);
      expect(id).toBe(11);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "nit",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 22 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 5);
      expect(id).toBe(22);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      const secondCallArgs = octokit.pulls.createReviewComment.mock.calls[1][0] as {
        subject_type: string;
        body: string;
      };
      expect(secondCallArgs.subject_type).toBe("file");
      expect(secondCallArgs.body).toContain("(line 5)");
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 33 } });

      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts");
      expect(id).toBe(33);
      const callArgs = octokit.pulls.createReviewComment.mock.calls[0][0] as {
        subject_type: string;
      };
      expect(callArgs.subject_type).toBe("file");
    });

    it("re-throws a non-422 error from the inline attempt without falling back", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(500, "boom"));

      await expect(
        client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*boom/);
    });

    it("returns 0 when the file itself is not in the diff (outer 422)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422));
      const id = await client.createPRReviewComment("owner/repo", 1, "nit", "src/missing.ts");
      expect(id).toBe(0);
    });

    it("wraps a non-422 outer error", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("down"));
      await expect(
        client.createPRReviewComment("owner/repo", 1, "nit", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*down/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
      await expect(
        client.replyToReviewComment("owner/repo", 1, 99, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));
      await expect(
        client.replyToReviewComment("owner/repo", 1, 99, "thanks"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("submits an APPROVE review", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });
      await client.submitPRReview("owner/repo", 1, "LGTM", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects REQUEST_CHANGES on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("owner/repo", 1, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "Needs work",
        event: "COMMENT",
      });
    });

    it("does not retry when the event is already COMMENT, even with a matching message", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      await expect(
        client.submitPRReview("owner/repo", 1, "Note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps an unrelated error", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("server exploded"));
      await expect(
        client.submitPRReview("owner/repo", 1, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*server exploded/);
    });
  });
});
