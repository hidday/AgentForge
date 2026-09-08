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

function statusError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
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
    it("rejects a repo string with no slash before hitting the API", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs when the repo is reachable", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with a permissions hint", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*Not Found/s,
      );
    });

    it("stringifies non-Error rejections", async () => {
      octokit.repos.get.mockRejectedValue("weird failure");

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(/weird failure/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors", async () => {
      octokit.repos.get.mockRejectedValue(new Error("network down"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*network down/s,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch head", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({});

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
        sha: "sha123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(statusError(422));

      await expect(client.createBranch("org/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps other errors", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(statusError(500, "server error"));

      await expect(client.createBranch("org/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo".*server error/s,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(num).toBe(7);
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

    it("throws on a 422 field validation error (invalid code)", async () => {
      octokit.pulls.create.mockRejectedValue(
        statusError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws on a 422 field validation error (missing_field code)", async () => {
      octokit.pulls.create.mockRejectedValue(
        statusError(422, '{"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "main", "", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns the existing open PR on a duplicate-head 422", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(num).toBe(55);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a duplicate-head 422 has no matching open PR", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws wrapped error for non-422 failures", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*rate limited/s);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("org/repo", 10, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));

      await expect(client.commentOnPR("org/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*forbidden/s,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("org/repo", 10)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/s,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("org/repo", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("org/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed.*gone/s,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("timeout"));

      await expect(client.listPRComments("org/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed.*timeout/s,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 12);

      expect(id).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts");

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 12);

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "*(line 12)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 when the fallback file-level comment also 422s", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422, "line not in diff"))
        .mockRejectedValueOnce(statusError(422, "file not in diff either"));

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 12);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns 0 when the file-level (no line) comment 422s", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(statusError(422, "file not in diff"));

      const id = await client.createPRReviewComment("org/repo", 10, "body", "src/a.ts");

      expect(id).toBe(0);
    });

    it("rethrows a non-422 error from the line-level attempt", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(statusError(500, "server error"));

      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/a.ts", 12),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/s);
    });

    it("wraps a non-422 error looking up the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("pr not found"));

      await expect(
        client.createPRReviewComment("org/repo", 10, "body", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*pr not found/s);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("org/repo", 10, 500, "reply");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        comment_id: 500,
        body: "reply",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("org/repo", 10, 500, "reply"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("org/repo", 10, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("org/repo", 10, "changes needed", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 10,
        body: "changes needed",
        event: "COMMENT",
      });
    });

    it("throws for an own-PR error when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("org/repo", 10, "note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("wraps unrelated errors", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("network error"));

      await expect(
        client.submitPRReview("org/repo", 10, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*network error/s);
    });
  });
});
