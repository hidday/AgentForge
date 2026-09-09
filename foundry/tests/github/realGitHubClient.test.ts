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

function buildClient() {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeFakeOctokit();
  // Inject a fake Octokit instance so no real network calls are made, mirroring
  // the injection style used for RealLinearClient in realLinearClient.relatedContext.test.ts.
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  describe("repo format validation", () => {
    it("throws when the repo string has no slash", async () => {
      const { client } = buildClient();
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/backend")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "backend" });
    });

    it("wraps the underlying error with an actionable message", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/backend")).rejects.toThrow(
        /cannot access repo "acme\/backend".*Not Found/,
      );
    });

    it("stringifies a non-Error rejection value in the wrapped message", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("acme/backend")).rejects.toThrow(
        /cannot access repo "acme\/backend".*plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/backend")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name and repo", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/backend")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/backend".*rate limited/,
      );
    });

    it("stringifies a non-Error rejection value via wrapError", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(503);

      await expect(client.getDefaultBranch("acme/backend")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/backend".*503/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch head sha", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/backend", "ai/lin-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend",
        ref: "refs/heads/ai/lin-1",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows a 422 (branch already exists) and logs instead of throwing", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/backend", "ai/lin-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ branchName: "ai/lin-1" }),
        expect.stringContaining("already exists"),
      );
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = buildClient();
      octokit.repos.get.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("acme/backend", "ai/lin-1")).rejects.toThrow(
        /GitHub createBranch failed.*network down/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const num = await client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body");

      expect(num).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ head: "ai/lin-1", base: "main", draft: true }),
      );
    });

    it("throws a wrapped error on a 422 field-validation failure (invalid code)", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/backend", "ai/lin-1", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 field-validation failure (missing_field code)", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a 422 duplicate-head error", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body");

      expect(num).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({ head: "acme:ai/lin-1", base: "main", state: "open" }),
      );
    });

    it("throws when a 422 duplicate-head error has no matching existing PR", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*server error/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/backend", 42, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "backend",
        issue_number: 42,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.createComment.mockRejectedValue(new Error("nope"));

      await expect(client.commentOnPR("acme/backend", 42, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*nope/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/backend", 42)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/backend", 42)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via the GraphQL mutation", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node123" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/backend", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "PR_node123" },
      );
    });

    it("does nothing when the PR is already not a draft", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_node123" } });

      await client.markPRReady("acme/backend", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("no access"));

      await expect(client.markPRReady("acme/backend", 42)).rejects.toThrow(
        /GitHub markPRReady failed.*no access/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author and body", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/backend", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      const { client, octokit } = buildClient();
      octokit.issues.listComments.mockRejectedValue(new Error("denied"));

      await expect(client.listPRComments("acme/backend", 42)).rejects.toThrow(
        /GitHub listPRComments failed.*denied/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts", 10);

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src/foo.ts", line: 10, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("creates a file-level comment when line is omitted", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const id = await client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts");

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src/foo.ts", subject_type: "file", commit_id: "sha1" }),
      );
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 503 } });

      const id = await client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts", 10);

      expect(id).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject_type: "file", body: expect.stringContaining("line 10") }),
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    it("propagates a non-422 line-comment error to the outer wrapper", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("weird failure"));

      await expect(
        client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*weird failure/);
    });

    it("returns 0 and logs a warning when the outer call itself 422s (file not in diff)", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 error from octokit.pulls.get", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.get.mockRejectedValue(new Error("fetch pr failed"));

      await expect(
        client.createPRReviewComment("acme/backend", 42, "body", "src/foo.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*fetch pr failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies successfully", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/backend", 42, 501, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 501, body: "thanks" }),
      );
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/backend", 42, 501, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        expect.stringContaining("Failed to reply"),
      );
    });

    it("stringifies a non-Error rejection value when logging the warning", async () => {
      const { client, octokit, logger } = buildClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("transient failure");

      await expect(
        client.replyToReviewComment("acme/backend", 42, 501, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "transient failure" }),
        expect.stringContaining("Failed to reply"),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/backend", 42, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "APPROVE", body: "LGTM" }),
      );
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the author's own PR", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/backend", 42, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: "COMMENT" }),
      );
    });

    it("wraps the error when it does not match the own-PR fallback pattern", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(
        client.submitPRReview("acme/backend", 42, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*service unavailable/);
    });

    it("wraps the error for a COMMENT event even if the message matches the own-PR pattern", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/backend", 42, "Just a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error rejection value when wrapping the error", async () => {
      const { client, octokit } = buildClient();
      octokit.pulls.createReview.mockRejectedValue("service down");

      await expect(
        client.submitPRReview("acme/backend", 42, "Needs work", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*service down/);
    });
  });
});
