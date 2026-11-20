import { describe, it, expect, vi, beforeEach } from "vitest";

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

const octokitInstances: FakeOctokit[] = [];

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

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => {
      const instance = makeFakeOctokit();
      octokitInstances.push(instance);
      return instance;
    }),
  };
});

// Imported after the mock is registered.
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeClient(): { client: RealGitHubClient; octokit: FakeOctokit; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = octokitInstances[octokitInstances.length - 1]!;
  return { client, octokit, logger };
}

beforeEach(() => {
  octokitInstances.length = 0;
});

describe("RealGitHubClient", () => {
  describe("repo format validation", () => {
    it("rejects with an Invalid repo format error for a repo string without a slash", async () => {
      const { client } = makeClient();
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format "not-a-valid-repo", expected "owner\/repo"/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with a helpful message on failure", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("not found"));

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /GitHub: cannot access repo "acme\/repo".*Original: not found/,
      );
    });

    it("stringifies a non-Error rejection value in the wrapped message", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      octokit.repos.get.mockRejectedValue("raw string failure");

      await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
        /Original: raw string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("develop");
    });

    it("wraps the error on failure", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/repo".*rate limited/,
      );
    });

    it("stringifies a non-Error rejection value via wrapError's fallback", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      octokit.repos.get.mockRejectedValue({ message: "object failure" });

      await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/repo": \[object Object\]/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch's sha", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await expect(client.createBranch("acme/repo", "ai/feature")).resolves.toBeUndefined();

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 from createRef as the branch already existing and logs info instead of throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      const err = Object.assign(new Error("Reference already exists"), { status: 422 });
      octokit.git.createRef.mockRejectedValue(err);

      await expect(client.createBranch("acme/repo", "ai/feature")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps non-422 errors", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network error"));

      await expect(client.createBranch("acme/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/repo".*network error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR("acme/repo", "ai/feature", "main", "Title", "Body");

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "ai/feature",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error for a 422 field validation failure (invalid base branch)", async () => {
      const { client, octokit, logger } = makeClient();
      const err = new Error('Validation failed: {"code":"invalid"}');
      Object.assign(err, { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("acme/repo", "ai/feature", "no-such-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/repo"/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR when a 422 indicates a duplicate head branch", async () => {
      const { client, octokit, logger } = makeClient();
      const err = new Error("A pull request already exists for acme:ai/feature.");
      Object.assign(err, { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR("acme/repo", "ai/feature", "main", "Title", "Body");

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        head: "acme:ai/feature",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error when a 422 duplicate-PR lookup finds no existing open PR", async () => {
      const { client, octokit } = makeClient();
      const err = new Error("A pull request already exists for acme:ai/feature.");
      Object.assign(err, { status: 422 });
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/repo", "ai/feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/repo"/);
    });

    it("throws a wrapped error for non-422 failures", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("acme/repo", "ai/feature", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/repo".*server error/);
    });

    it("treats a 422 whose rejection value is not an Error as non-field-validation and looks up the existing PR", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      octokit.pulls.create.mockRejectedValue(Object.assign({}, { status: 422 }));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const prNumber = await client.createDraftPR("acme/repo", "ai/feature", "main", "Title", "Body");

      expect(prNumber).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await expect(client.commentOnPR("acme/repo", 10, "hello")).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps errors from createComment", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("acme/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/repo".*boom/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/repo", 5)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/repo", 5)).rejects.toThrow(
        /GitHub getPRDiff failed for "acme\/repo".*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await expect(client.markPRReady("acme/repo", 5)).resolves.toBeUndefined();
      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does nothing when the PR is already not a draft", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await expect(client.markPRReady("acme/repo", 5)).resolves.toBeUndefined();
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("acme/repo", 5)).rejects.toThrow(
        /GitHub markPRReady failed for "acme\/repo".*gone/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments and falls back to defaults for missing fields", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/repo", 5);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("returns an empty array when there are no comments", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockResolvedValue({ data: [] });

      await expect(client.listPRComments("acme/repo", 5)).resolves.toEqual([]);
    });

    it("wraps errors", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/repo", 5)).rejects.toThrow(
        /GitHub listPRComments failed for "acme\/repo".*boom/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment using the PR head sha", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 999 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts", 10);

      expect(id).toBe(999);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      const lineErr = Object.assign(new Error("line not in diff"), { status: 422 });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(lineErr)
        .mockResolvedValueOnce({ data: { id: 1001 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts", 10);

      expect(id).toBe(1001);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-comment error so it is wrapped by the outer handler", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/repo".*server exploded/);
    });

    it("creates a file-level comment directly when no line is given", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 42 } });

      const id = await client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts");

      expect(id).toBe(42);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the PR itself cannot be loaded with a 422 (file not in diff)", async () => {
      const { client, octokit, logger } = makeClient();
      const err = Object.assign(new Error("not in diff"), { status: 422 });
      octokit.pulls.get.mockRejectedValue(err);

      const id = await client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps non-422 errors from loading the PR", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("acme/repo", 5, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/repo".*network down/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply and logs debug on success", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(client.replyToReviewComment("acme/repo", 5, 10, "thanks")).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/repo", 5, 10, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection value when logging the warning", async () => {
      const { client, octokit, logger } = makeClient();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("deleted");

      await expect(
        client.replyToReviewComment("acme/repo", 5, 10, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "deleted" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await expect(client.submitPRReview("acme/repo", 5, "LGTM", "APPROVE")).resolves.toBeUndefined();
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        body: "LGTM",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to COMMENT when requesting changes on one's own PR", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("acme/repo", 5, "Needs fixes", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "repo",
        pull_number: 5,
        body: "Needs fixes",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not fall back and instead throws when the event is already COMMENT", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/repo", 5, "LGTM", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/repo"/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps unrelated errors without falling back", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("acme/repo", 5, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/repo".*rate limited/);
    });

    it("does not fall back for a non-Error rejection value that does not match the own-PR message", async () => {
      const { client, octokit } = makeClient();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      octokit.pulls.createReview.mockRejectedValue({ weird: "failure" });

      await expect(
        client.submitPRReview("acme/repo", 5, "LGTM", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/repo"/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
