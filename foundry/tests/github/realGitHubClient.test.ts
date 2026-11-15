import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function installFakeOctokit(client: RealGitHubClient, octokit: Record<string, unknown>) {
  (client as unknown as { octokit: unknown }).octokit = octokit;
}

function httpError(status: number, message = "boom") {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
  });

  describe("repo format validation", () => {
    it("rejects a repo string without a slash on every method", async () => {
      await expect(client.getDefaultBranch("bad-format")).rejects.toThrow(
        'Invalid repo format "bad-format", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when octokit.repos.get succeeds", async () => {
      installFakeOctokit(client, { repos: { get: vi.fn().mockResolvedValue({ data: {} }) } });
      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith({ repo: "acme/repo" }, "Verified GitHub repo access");
    });

    it("throws a descriptive error when octokit.repos.get fails", async () => {
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockRejectedValue(new Error("not found")) },
      });
      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /cannot access repo "acme\/repo".*Original: not found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
      });
      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
    });

    it("wraps the error on failure", async () => {
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockRejectedValue(new Error("rate limited")) },
      });
      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/repo": rate limited',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } });
      const createRef = vi.fn().mockResolvedValue({});
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
        git: { getRef, createRef },
      });

      await client.createBranch("acme/repo", "feature/x");

      expect(getRef).toHaveBeenCalledWith({ owner: "acme", repo: "repo", ref: "heads/main" });
      expect(createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "sha123",
      });
    });

    it("treats a 422 as the branch already existing and returns without throwing", async () => {
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } }),
          createRef: vi.fn().mockRejectedValue(httpError(422)),
        },
      });

      await expect(client.createBranch("acme/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/repo", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 error", async () => {
      installFakeOctokit(client, {
        repos: { get: vi.fn().mockRejectedValue(httpError(500, "server error")) },
      });

      await expect(client.createBranch("acme/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/repo".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      installFakeOctokit(client, {
        pulls: { create: vi.fn().mockResolvedValue({ data: { number: 42 } }) },
      });

      await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).resolves.toBe(42);
    });

    it("throws for a 422 field-validation error without looking up existing PRs", async () => {
      const list = vi.fn();
      installFakeOctokit(client, {
        pulls: {
          create: vi
            .fn()
            .mockRejectedValue(httpError(422, '{"message":"Validation Failed","errors":[{"code":"invalid"}]}')),
          list,
        },
      });

      await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
      expect(list).not.toHaveBeenCalled();
    });

    it("returns the existing PR number when one is already open for the head branch", async () => {
      installFakeOctokit(client, {
        pulls: {
          create: vi.fn().mockRejectedValue(httpError(422, "A pull request already exists")),
          list: vi.fn().mockResolvedValue({ data: [{ number: 99 }] }),
        },
      });

      await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).resolves.toBe(99);
    });

    it("re-throws when a 422 occurs but no existing PR is found", async () => {
      installFakeOctokit(client, {
        pulls: {
          create: vi.fn().mockRejectedValue(httpError(422, "A pull request already exists")),
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      });

      await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("wraps a non-422 error", async () => {
      installFakeOctokit(client, {
        pulls: { create: vi.fn().mockRejectedValue(httpError(500)) },
      });

      await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });
  });

  describe("commentOnPR", () => {
    it("resolves on success", async () => {
      installFakeOctokit(client, { issues: { createComment: vi.fn().mockResolvedValue({}) } });
      await expect(client.commentOnPR("acme/repo", 1, "hi")).resolves.toBeUndefined();
    });

    it("wraps the error on failure", async () => {
      installFakeOctokit(client, {
        issues: { createComment: vi.fn().mockRejectedValue(new Error("fail")) },
      });
      await expect(client.commentOnPR("acme/repo", 1, "hi")).rejects.toThrow(
        /GitHub commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      installFakeOctokit(client, {
        pulls: { get: vi.fn().mockResolvedValue({ data: "diff --git a b" }) },
      });
      await expect(client.getPRDiff("acme/repo", 1)).resolves.toBe("diff --git a b");
    });

    it("wraps the error on failure", async () => {
      installFakeOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("fail")) } });
      await expect(client.getPRDiff("acme/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      const graphql = vi.fn();
      installFakeOctokit(client, {
        pulls: { get: vi.fn().mockResolvedValue({ data: { draft: false, node_id: "n1" } }) },
        graphql,
      });

      await client.markPRReady("acme/repo", 1);
      expect(graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation for a draft PR", async () => {
      const graphql = vi.fn().mockResolvedValue({});
      installFakeOctokit(client, {
        pulls: { get: vi.fn().mockResolvedValue({ data: { draft: true, node_id: "n1" } }) },
        graphql,
      });

      await client.markPRReady("acme/repo", 1);
      expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "n1",
      });
    });

    it("wraps the error on failure", async () => {
      installFakeOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("fail")) } });
      await expect(client.markPRReady("acme/repo", 1)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      installFakeOctokit(client, {
        issues: {
          listComments: vi.fn().mockResolvedValue({
            data: [
              { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
              { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
            ],
          }),
        },
      });

      const comments = await client.listPRComments("acme/repo", 1);
      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps the error on failure", async () => {
      installFakeOctokit(client, {
        issues: { listComments: vi.fn().mockRejectedValue(new Error("fail")) },
      });
      await expect(client.listPRComments("acme/repo", 1)).rejects.toThrow(/GitHub listPRComments failed/);
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      installFakeOctokit(client, {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
          createReviewComment: vi.fn().mockResolvedValue({ data: { id: 555 } }),
        },
      });

      const id = await client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts", 10);
      expect(id).toBe(555);
    });

    it("creates a file-level comment when line is omitted", async () => {
      const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 777 } });
      installFakeOctokit(client, {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
          createReviewComment,
        },
      });

      const id = await client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts");
      expect(id).toBe(777);
      expect(createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file", path: "src/a.ts" }),
      );
    });

    it("falls back to a file-level comment when the line-level attempt 422s", async () => {
      const createReviewComment = vi
        .fn()
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 888 } });
      installFakeOctokit(client, {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
          createReviewComment,
        },
      });

      const id = await client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts", 10);
      expect(id).toBe(888);
      expect(createReviewComment).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/repo", prNumber: 1, path: "src/a.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("re-throws a non-422 error from the line-level attempt", async () => {
      installFakeOctokit(client, {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
          createReviewComment: vi.fn().mockRejectedValue(new Error("network down")),
        },
      });

      await expect(
        client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("returns 0 when the overall attempt fails with a 422", async () => {
      installFakeOctokit(client, {
        pulls: { get: vi.fn().mockRejectedValue(httpError(422)) },
      });

      const id = await client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts");
      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/repo", prNumber: 1, path: "src/a.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 error from pulls.get", async () => {
      installFakeOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("fail")) } });

      await expect(
        client.createPRReviewComment("acme/repo", 1, "body", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves on success", async () => {
      installFakeOctokit(client, {
        pulls: { createReplyForReviewComment: vi.fn().mockResolvedValue({}) },
      });
      await expect(client.replyToReviewComment("acme/repo", 1, 555, "thanks")).resolves.toBeUndefined();
    });

    it("swallows the error and logs a warning instead of throwing", async () => {
      installFakeOctokit(client, {
        pulls: { createReplyForReviewComment: vi.fn().mockRejectedValue(new Error("fail")) },
      });

      await expect(client.replyToReviewComment("acme/repo", 1, 555, "thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/repo", prNumber: 1, commentId: 555, error: "fail" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits the review as given on success", async () => {
      const createReview = vi.fn().mockResolvedValue({});
      installFakeOctokit(client, { pulls: { createReview } });

      await client.submitPRReview("acme/repo", 1, "lgtm", "APPROVE");
      expect(createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "APPROVE", body: "lgtm" }),
      );
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because the author owns the PR", async () => {
      const createReview = vi
        .fn()
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});
      installFakeOctokit(client, { pulls: { createReview } });

      await client.submitPRReview("acme/repo", 1, "please fix", "REQUEST_CHANGES");

      expect(createReview).toHaveBeenCalledTimes(2);
      expect(createReview).toHaveBeenNthCalledWith(2, expect.objectContaining({ event: "COMMENT" }));
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/repo", prNumber: 1, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("re-throws when the own-PR fallback does not apply (event already COMMENT)", async () => {
      installFakeOctokit(client, {
        pulls: {
          createReview: vi
            .fn()
            .mockRejectedValue(new Error("Can not request changes on your own pull request")),
        },
      });

      await expect(client.submitPRReview("acme/repo", 1, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });

    it("wraps any other error", async () => {
      installFakeOctokit(client, { pulls: { createReview: vi.fn().mockRejectedValue(new Error("down")) } });

      await expect(client.submitPRReview("acme/repo", 1, "note", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });
  });
});
