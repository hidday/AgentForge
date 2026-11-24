import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

const octokitMock = {
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
  Octokit: vi.fn().mockImplementation(() => octokitMock),
}));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeHttpError(status: number, message = "error") {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the repo is not in owner/repo format", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
      /Invalid repo format/,
    );
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokitMock.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    });

    it("wraps the error with a clear message when access fails", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("Not Found"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo"/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
    });

    it("wraps errors with the operation name", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo"/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokitMock.git.createRef.mockResolvedValue({ data: {} });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.createBranch("org/repo", "feature/x");

      expect(octokitMock.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokitMock.repos.get.mockRejectedValue(makeHttpError(422));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ branchName: "feature/x" }),
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps non-422 errors", async () => {
      octokitMock.repos.get.mockRejectedValue(makeHttpError(500, "server error"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      octokitMock.pulls.create.mockResolvedValue({ data: { number: 42 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).resolves.toBe(42);
    });

    it("rethrows a 422 field-validation error without looking up an existing PR", async () => {
      const err = makeHttpError(422, '{"code":"invalid","field":"base"}');
      octokitMock.pulls.create.mockRejectedValue(err);
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/createDraftPR failed/);
      expect(octokitMock.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a generic 422 (PR already exists)", async () => {
      octokitMock.pulls.create.mockRejectedValue(makeHttpError(422, "already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).resolves.toBe(7);
    });

    it("rethrows when a 422 occurs but no existing open PR is found", async () => {
      octokitMock.pulls.create.mockRejectedValue(makeHttpError(422, "already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [] });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });
  });

  it("commentOnPR posts an issue comment and wraps failures", async () => {
    octokitMock.issues.createComment.mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    await client.commentOnPR("org/repo", 1, "hi");
    expect(octokitMock.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 1,
      body: "hi",
    });

    octokitMock.issues.createComment.mockRejectedValue(new Error("fail"));
    await expect(client.commentOnPR("org/repo", 1, "hi")).rejects.toThrow(
      /commentOnPR failed/,
    );
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getPRDiff("org/repo", 1)).resolves.toBe("diff --git a/x b/x");
    });

    it("wraps failures", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("fail"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("is a no-op when the PR is already not a draft", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: false } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.markPRReady("org/repo", 1);

      expect(octokitMock.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokitMock.graphql.mockResolvedValue({});
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.markPRReady("org/repo", 1);

      expect(octokitMock.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "node-1" },
      );
    });

    it("wraps failures", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("fail"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(/markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing user/body", async () => {
      octokitMock.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hello", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const comments = await client.listPRComments("org/repo", 1);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps failures", async () => {
      octokitMock.issues.listComments.mockRejectedValue(new Error("fail"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(
        /listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 55 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10);

      expect(id).toBe(55);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ line: 10, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment
        .mockRejectedValueOnce(makeHttpError(422))
        .mockResolvedValueOnce({ data: { id: 66 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10);

      expect(id).toBe(66);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      const secondCall = octokitMock.pulls.createReviewComment.mock.calls[1]![0];
      expect(secondCall.subject_type).toBe("file");
      expect(secondCall.body).toContain("(line 10)");
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 77 } });
      const client = new RealGitHubClient("token", makeLogger() as never);

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts");

      expect(id).toBe(77);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file" }),
      );
    });

    it("rethrows a non-422 error from the line-level attempt", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockRejectedValue(new Error("other failure"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });

    it("returns 0 and warns when the overall request 422s (file not in diff) with no line", async () => {
      octokitMock.pulls.get.mockRejectedValue(makeHttpError(422));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 failure from pulls.get", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("fail"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.createPRReviewComment("org/repo", 1, "body", "src/a.ts"),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves on success", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockResolvedValue({});
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.replyToReviewComment("org/repo", 1, 55, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows failures and only logs a warning", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(new Error("fail"));
      const logger = makeLogger();
      const client = new RealGitHubClient("token", logger as never);

      await expect(
        client.replyToReviewComment("org/repo", 1, 55, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ commentId: 55 }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits the review as given", async () => {
      octokitMock.pulls.createReview.mockResolvedValue({});
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.submitPRReview("org/repo", 1, "LGTM", "APPROVE");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "APPROVE" }),
      );
    });

    it("falls back to COMMENT when requesting changes on its own PR", async () => {
      octokitMock.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});
      const client = new RealGitHubClient("token", makeLogger() as never);

      await client.submitPRReview("org/repo", 1, "notes", "REQUEST_CHANGES");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokitMock.pulls.createReview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ event: "COMMENT" }),
      );
    });

    it("rethrows other failures", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(new Error("boom"));
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.submitPRReview("org/repo", 1, "notes", "APPROVE"),
      ).rejects.toThrow(/submitPRReview failed/);
    });

    it("does not fall back to COMMENT for an already-COMMENT event even on the same error text", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      const client = new RealGitHubClient("token", makeLogger() as never);

      await expect(
        client.submitPRReview("org/repo", 1, "notes", "COMMENT"),
      ).rejects.toThrow(/submitPRReview failed/);
    });
  });
});
