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

function buildClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
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
    ({ client, octokit, logger } = buildClient());
  });

  describe("repo format validation", () => {
    it("throws for a repo string without an owner/repo slash", async () => {
      await expect(client.verifyRepoAccess("no-slash-here")).rejects.toThrow(
        'Invalid repo format "no-slash-here", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
    });

    it("wraps the underlying error with actionable context", async () => {
      octokit.repos.get.mockRejectedValue(httpError(404, "Not Found"));
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /cannot access repo "owner\/repo".*Not Found/,
      );
    });

    it("stringifies a non-Error rejection when wrapping the failure", async () => {
      octokit.repos.get.mockRejectedValue("rate limit exceeded");
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /cannot access repo "owner\/repo".*rate limit exceeded/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps failures", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo": boom',
      );
    });

    it("stringifies a non-Error rejection when wrapping the failure", async () => {
      octokit.repos.get.mockRejectedValue(503);
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo": 503',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch's head sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("owner/repo", "ai/feature-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature-1",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("owner/repo", "ai/feature-1")).resolves.toBeUndefined();
    });

    it("rethrows wrapped for non-422 errors", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("owner/repo", "ai/feature-1")).rejects.toThrow(
        'GitHub createBranch failed for "owner/repo"',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(7);
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

    it("rethrows on a 422 field validation error (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, '{"code":"invalid","field":"base"}'));

      await expect(
        client.createDraftPR("owner/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("rethrows on a 422 missing_field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("looks up and returns an existing open PR when creation 422s for a duplicate head", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(55);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("rethrows when a 422 duplicate-PR error occurs but no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("rethrows wrapped for non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("treats a non-Error 422 rejection as a duplicate-head lookup, not field validation", async () => {
      const nonErrorRejection = { status: 422, toString: () => "duplicate head ref" };
      octokit.pulls.create.mockRejectedValue(nonErrorRejection);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 61 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(61);
      expect(octokit.pulls.list).toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});
      await client.commentOnPR("owner/repo", 3, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 3,
        body: "hello",
      });
    });

    it("wraps failures", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
      await expect(client.commentOnPR("owner/repo", 3, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "owner/repo"',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
      await expect(client.getPRDiff("owner/repo", 3)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        mediaType: { format: "diff" },
      });
    });

    it("wraps failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("owner/repo", 3)).rejects.toThrow(
        'GitHub getPRDiff failed for "owner/repo"',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 3);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("does nothing when the PR is already ready (not draft)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("owner/repo", 3);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.markPRReady("owner/repo", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo"',
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

      const comments = await client.listPRComments("owner/repo", 3);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps failures", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("owner/repo", 3)).rejects.toThrow(
        'GitHub listPRComments failed for "owner/repo"',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 9 } });

      const id = await client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts", 10);

      expect(id).toBe(9);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "note",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level review comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 11 } });

      const id = await client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts");

      expect(id).toBe(11);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 12 } });

      const id = await client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts", 10);

      expect(id).toBe(12);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "*(line 10)* note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and does not throw when posting still 422s (file not in diff)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "not in diff"));

      const id = await client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts", 10);

      expect(id).toBe(0);
    });

    it("rethrows a non-422 error from the line-level attempt", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });

    it("wraps a failure to fetch the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(
        client.createPRReviewComment("owner/repo", 3, "note", "src/a.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await client.replyToReviewComment("owner/repo", 3, 99, "thanks");
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        comment_id: 99,
        body: "thanks",
      });
    });

    it("swallows errors and does not throw", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
      await expect(
        client.replyToReviewComment("owner/repo", 3, 99, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows a non-Error rejection and logs its stringified form", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("comment deleted");
      await expect(
        client.replyToReviewComment("owner/repo", 3, 99, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("owner/repo", 3, "LGTM", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("owner/repo", 3, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "Needs work",
        event: "COMMENT",
      });
    });

    it("rethrows wrapped when the error is unrelated to the own-PR restriction", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("network down"));

      await expect(
        client.submitPRReview("owner/repo", 3, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });

    it("rethrows wrapped when event is already COMMENT and it fails", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("owner/repo", 3, "Just a note", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });

    it("stringifies a non-Error rejection when wrapping the failure", async () => {
      octokit.pulls.createReview.mockRejectedValue({ toString: () => "service unavailable" });

      await expect(
        client.submitPRReview("owner/repo", 3, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });
  });
});
