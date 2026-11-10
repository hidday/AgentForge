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

function makeHttpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// Builds a fake Octokit surface with vi.fn() mocks for every endpoint the
// client touches, injected directly onto the private `octokit` field -- the
// same convention used by the existing RealLinearClient SDK-injection tests.
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

function injectOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

describe("RealGitHubClient", () => {
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeFakeOctokit();
    logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    injectOctokit(client, octokit);
  });

  describe("repo format validation", () => {
    it("rejects a repo string without a slash before making any API call", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with a helpful message when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /cannot access repo "owner\/repo".*Not Found/,
      );
    });

    it("wraps a non-Error rejection using String()", async () => {
      octokit.repos.get.mockRejectedValue("some string failure");
      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(/some string failure/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps errors", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo".*rate limited/,
      );
    });

    it("wraps a non-Error rejection using String() inside wrapError too", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");
      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /plain string failure/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref off the default branch's sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("owner/repo", "ai/feature");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(makeHttpError(422));

      await expect(client.createBranch("owner/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps other errors", async () => {
      octokit.repos.get.mockRejectedValue(makeHttpError(500, "server error"));

      await expect(client.createBranch("owner/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo".*server error/,
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

    it("throws when a 422 is a field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeHttpError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      octokit.pulls.create.mockRejectedValue(makeHttpError(422, "A pull request already exists"));
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

    it("throws when the 422 lookup finds no existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(makeHttpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/network down/);
    });

    it("handles a non-Error 422 rejection (status check via String()) and still looks up the PR", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 60 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(60);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });
      await client.commentOnPR("owner/repo", 3, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 3,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));
      await expect(client.commentOnPR("owner/repo", 3, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("owner/repo", 3)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("owner/repo", 3)).rejects.toThrow(
        /GitHub getPRDiff failed.*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });
      await client.markPRReady("owner/repo", 3);
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 3);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("no access"));
      await expect(client.markPRReady("owner/repo", 3)).rejects.toThrow(
        /GitHub markPRReady failed.*no access/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, falling back for missing user/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const result = await client.listPRComments("owner/repo", 3);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("rate limited"));
      await expect(client.listPRComments("owner/repo", 3)).rejects.toThrow(
        /GitHub listPRComments failed.*rate limited/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-anchored comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 99 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        3,
        "body",
        "src/file.ts",
        10,
      );

      expect(result).toBe(99);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "body",
        path: "src/file.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 100 } });

      const result = await client.createPRReviewComment("owner/repo", 3, "body", "src/file.ts");

      expect(result).toBe(100);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "body",
        path: "src/file.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(makeHttpError(422))
        .mockResolvedValueOnce({ data: { id: 101 } });

      const result = await client.createPRReviewComment(
        "owner/repo",
        3,
        "body",
        "src/file.ts",
        10,
      );

      expect(result).toBe(101);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "*(line 10)* body",
        path: "src/file.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("propagates a non-422 line-comment error up to the outer handler and wraps it", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValueOnce(new Error("boom"));

      await expect(
        client.createPRReviewComment("owner/repo", 3, "body", "src/file.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*boom/);
    });

    it("returns 0 and logs a warning when the outer call fails with 422 (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(makeHttpError(422));

      const result = await client.createPRReviewComment("owner/repo", 3, "body", "src/file.ts");

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps non-422 outer errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createPRReviewComment("owner/repo", 3, "body", "src/file.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server exploded/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies successfully", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
      await client.replyToReviewComment("owner/repo", 3, 123, "thanks");
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        comment_id: 123,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));
      await expect(
        client.replyToReviewComment("owner/repo", 3, 123, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("swallows a non-Error rejection using String() in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");
      await expect(
        client.replyToReviewComment("owner/repo", 3, 123, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review successfully", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });
      await client.submitPRReview("owner/repo", 3, "LGTM", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("owner/repo", 3, "Needs fixes", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 3,
        body: "Needs fixes",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps the error when the event is already COMMENT (no fallback possible)", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("owner/repo", 3, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed/,
      );
    });

    it("wraps errors that do not match the own-PR fallback pattern", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("totally unrelated failure"));

      await expect(
        client.submitPRReview("owner/repo", 3, "note", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*totally unrelated failure/);
    });

    it("wraps a non-Error rejection using String() when checking the own-PR pattern", async () => {
      octokit.pulls.createReview.mockRejectedValue({ weird: "failure" });

      await expect(
        client.submitPRReview("owner/repo", 3, "note", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });
  });
});
