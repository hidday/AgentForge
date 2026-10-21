import { describe, it, expect, vi, beforeEach } from "vitest";

const octokitMock = vi.hoisted(() => ({
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
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => octokitMock),
}));

const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function resetOctokitMock() {
  for (const group of Object.values(octokitMock)) {
    if (typeof group === "function") {
      group.mockReset();
    } else {
      for (const fn of Object.values(group)) fn.mockReset();
    }
  }
}

describe("RealGitHubClient", () => {
  let client: InstanceType<typeof RealGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    resetOctokitMock();
    logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
  });

  describe("repo format validation", () => {
    it("throws when the repo string has no slash", async () => {
      await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokitMock.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("wraps the underlying error with a helpful message", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("404 Not Found"));

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*404 Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors from the API", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*boom/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokitMock.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("org/repo", "ai/feature");

      expect(octokitMock.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokitMock.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "sha123",
      });
    });

    it("treats a 422 (branch already exists) as success, not an error", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokitMock.git.createRef.mockRejectedValue({ status: 422 });

      await expect(client.createBranch("org/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("rethrows (wrapped) a non-422 error", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("org/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokitMock.pulls.create.mockResolvedValue({ data: { number: 7 } });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).resolves.toBe(7);
      expect(octokitMock.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure", async () => {
      octokitMock.pulls.create.mockRejectedValue(
        Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 }),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("falls back to the existing open PR on a 422 that isn't field validation", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokitMock.pulls.create.mockRejectedValue(err);
      octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).resolves.toBe(55);
      expect(octokitMock.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 'already exists' error has no matching open PR", async () => {
      const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
      octokitMock.pulls.create.mockRejectedValue(err);
      octokitMock.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokitMock.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("org/repo", 3, "hello");

      expect(octokitMock.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 3,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokitMock.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("org/repo", 3, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("org/repo", 3)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 3)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("is a no-op when the PR is already not a draft", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: false } });

      await client.markPRReady("org/repo", 3);

      expect(octokitMock.graphql).not.toHaveBeenCalled();
    });

    it("calls the markReadyForReview mutation when the PR is a draft", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokitMock.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 3);

      expect(octokitMock.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "node-1" },
      );
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("org/repo", 3)).rejects.toThrow(/GitHub markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps API comments to the PRComment shape, defaulting missing fields", async () => {
      octokitMock.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 3);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokitMock.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("org/repo", 3)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 11 } });

      const id = await client.createPRReviewComment("org/repo", 3, "body", "a.ts", 5);

      expect(id).toBe(11);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ path: "a.ts", line: 5, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment
        .mockRejectedValueOnce({ status: 422 })
        .mockResolvedValueOnce({ data: { id: 22 } });

      const id = await client.createPRReviewComment("org/repo", 3, "body", "a.ts", 5);

      expect(id).toBe(22);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject_type: "file", body: "*(line 5)* body" }),
      );
    });

    it("rethrows a non-422 line-comment error up through the outer catch", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockRejectedValueOnce(new Error("network"));

      await expect(
        client.createPRReviewComment("org/repo", 3, "body", "a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 33 } });

      const id = await client.createPRReviewComment("org/repo", 3, "body", "a.ts");

      expect(id).toBe(33);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file", body: "body" }),
      );
    });

    it("returns 0 (skips) when the overall operation 422s outside the line-fallback path", async () => {
      octokitMock.pulls.get.mockRejectedValue({ status: 422 });

      await expect(client.createPRReviewComment("org/repo", 3, "body", "a.ts")).resolves.toBe(0);
    });

    it("wraps a non-422 error from the outer try", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.createPRReviewComment("org/repo", 3, "body", "a.ts")).rejects.toThrow(
        /GitHub createPRReviewComment failed/,
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves on success", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(client.replyToReviewComment("org/repo", 3, 11, "thanks")).resolves.toBeUndefined();
    });

    it("swallows errors (logs a warning instead of throwing)", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));

      await expect(client.replyToReviewComment("org/repo", 3, 11, "thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokitMock.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("org/repo", 3, "lgtm", "APPROVE");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "APPROVE", body: "lgtm" }),
      );
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokitMock.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("org/repo", 3, "needs work", "REQUEST_CHANGES");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokitMock.pulls.createReview).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: "COMMENT" }),
      );
    });

    it("rethrows (wrapped) any other error", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(new Error("server error"));

      await expect(client.submitPRReview("org/repo", 3, "lgtm", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });

    it("rethrows (wrapped) the 'own PR' error when the event is already COMMENT", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("org/repo", 3, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });
  });
});
