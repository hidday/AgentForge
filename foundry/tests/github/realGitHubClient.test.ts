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

function statusError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** A non-Error rejection value, to exercise the `err instanceof Error ? ... : String(err)` fallback branch. */
function nonErrorRejection(status?: number): unknown {
  return status === undefined ? "plain string failure" : { status, toString: () => "plain object failure" };
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

  describe("repo name parsing", () => {
    it("throws a clear error when repo is not in 'owner/repo' format", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug when repos.get succeeds", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("wraps the error with actionable guidance when repos.get fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("404 Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Original: 404 Not Found/,
      );
    });

    it("stringifies a non-Error rejection value instead of reading .message", async () => {
      octokit.repos.get.mockRejectedValue(nonErrorRejection());

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        "Original: plain string failure",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors with operation context", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": rate limited',
      );
    });

    it("wraps a non-Error rejection via String() instead of throwing on .message access", async () => {
      octokit.repos.get.mockRejectedValue(nonErrorRejection());

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": plain string failure',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/ai/issue-1",
        sha: "abc123",
      });
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(statusError(422));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "ai/issue-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 error with branchName context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("no such ref"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets" {"branchName":"ai/issue-1"}: no such ref',
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const result = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(result).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "ai/issue-1",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws on 422 field validation errors (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        statusError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "bogus-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns the existing PR number on 422 'already exists' when one is found", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(result).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:ai/issue-1",
        base: "main",
        state: "open",
      });
    });

    it("throws when 422 'already exists' but no matching open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("treats a non-Error 422 rejection's stringified form as non-field-validation and looks up the existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(nonErrorRejection(422));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const result = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(result).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 10, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors with prNumber context", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("forbidden"));

      await expect(client.commentOnPR("acme/widgets", 10, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":10}: forbidden',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/widgets", 10)).resolves.toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 10)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/widgets" {"prNumber":10}: not found',
      );
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the GraphQL mutation to mark a draft PR ready", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("acme/widgets", 10)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":10}: gone',
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

      const comments = await client.listPRComments("acme/widgets", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("timeout"));

      await expect(client.listPRComments("acme/widgets", 10)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/widgets" {"prNumber":10}: timeout',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "fix this",
        "src/a.ts",
        42,
      );

      expect(id).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "fix this",
        path: "src/a.ts",
        line: 42,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422))
        .mockResolvedValueOnce({ data: { id: 999 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "fix this",
        "src/a.ts",
        42,
      );

      expect(id).toBe(999);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "*(line 42)* fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 321 } });

      const id = await client.createPRReviewComment("acme/widgets", 10, "note", "src/a.ts");

      expect(id).toBe(321);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the outer request 422s (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(statusError(422));

      const id = await client.createPRReviewComment("acme/widgets", 10, "note", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-line-specific error from the line branch (not a 422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "note", "src/a.ts", 42),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });

    it("wraps non-422 errors from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "note", "src/a.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });
  });

  describe("replyToReviewComment", () => {
    it("replies successfully and logs debug", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 10, 555, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        comment_id: 555,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the logged warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(nonErrorRejection());

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 10, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub refuses REQUEST_CHANGES on the author's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 10, "please fix", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "please fix",
        event: "COMMENT",
      });
    });

    it("wraps other errors instead of falling back", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(
        client.submitPRReview("acme/widgets", 10, "LGTM", "APPROVE"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
    });

    it("does not attempt the own-PR fallback for a COMMENT event", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 10, "note", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
    });

    it("wraps a non-Error rejection via String() instead of throwing on .message access", async () => {
      octokit.pulls.createReview.mockRejectedValue(nonErrorRejection());

      await expect(
        client.submitPRReview("acme/widgets", 10, "LGTM", "APPROVE"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
    });
  });
});
