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

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** A non-Error rejection carrying an HTTP-style status, to exercise the
 * `err instanceof Error ? ... : String(err)` false branches. */
function nonErrorHttpFailure(status: number): { status: number; toString(): string } {
  return { status, toString: () => `NonError(status=${String(status)})` };
}

describe("RealGitHubClient", () => {
  describe("splitRepo validation", () => {
    it("rejects when repo is not in owner/repo format", async () => {
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

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps a failure with a helpful message and cause", async () => {
      const { client, octokit } = makeClient();
      const original = new Error("Not Found");
      octokit.repos.get.mockRejectedValue(original);

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toMatchObject({
        message: expect.stringContaining(
          'GitHub: cannot access repo "owner/repo". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
        ) as unknown as string,
        cause: original,
      });
    });

    it("stringifies a non-Error rejection", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /Original: plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockRejectedValue(new Error("network down"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo": network down/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's ref sha", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

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
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 as 'branch already exists' and returns without throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("owner/repo", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/issue-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 failure", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("owner/repo", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo"/,
      );
    });

    it("wrapError stringifies a non-Error rejection", async () => {
      const { client, octokit } = makeClient();
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue("plain string failure");

      await expect(client.createBranch("owner/repo", "ai/issue-1")).rejects.toThrow(
        /plain string failure/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws on a 422 field-validation error (invalid field)", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, '{"code":"invalid","field":"base"}'));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws on a 422 field-validation error (missing_field)", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);
    });

    it("looks up and returns an existing open PR when 422 is not field validation", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "T", "B");

      expect(result).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 77 },
        "Found existing open PR",
      );
    });

    it("throws when 422-but-not-field-validation and no existing PR is found", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(httpError(422, "some other reason"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);
    });

    it("throws wrapped error for a non-422 failure", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(httpError(500, "server error"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "T", "B"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);
    });

    it("treats a non-Error 422 rejection as not-field-validation and looks up the existing PR", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.create.mockRejectedValue(nonErrorHttpFailure(422));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "T", "B");

      expect(result).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("owner/repo", 5, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 5,
        body: "hello",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps a failure", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("owner/repo", 5, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "owner\/repo"/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("owner/repo", 3)).resolves.toBe("diff --git a b");
    });

    it("wraps a failure", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("owner/repo", 3)).rejects.toThrow(
        /GitHub getPRDiff failed for "owner\/repo"/,
      );
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql if the PR is already not a draft", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: false } });

      await client.markPRReady("owner/repo", 9);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation for a draft PR", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 9);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.any(String), { prId: "PR_node" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps a failure from pulls.get", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("owner/repo", 9)).rejects.toThrow(
        /GitHub markPRReady failed for "owner\/repo"/,
      );
    });

    it("wraps a failure from the graphql mutation", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node" } });
      octokit.graphql.mockRejectedValue(new Error("mutation failed"));

      await expect(client.markPRReady("owner/repo", 9)).rejects.toThrow(
        /GitHub markPRReady failed for "owner\/repo"/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01" },
          { id: 2, user: null, body: null, created_at: "2024-01-02" },
        ],
      });

      const result = await client.listPRComments("owner/repo", 1);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02" },
      ]);
    });

    it("wraps a failure", async () => {
      const { client, octokit } = makeClient();
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("owner/repo", 1)).rejects.toThrow(
        /GitHub listPRComments failed for "owner\/repo"/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("returns 0 (and warns) when fetching the PR itself fails with 422", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockRejectedValue(httpError(422));

      const result = await client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5);

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 failure fetching the PR", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "owner\/repo"/);
    });

    it("posts a line comment directly when the line is in the diff", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const result = await client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5);

      expect(result).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "body",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 556 } });

      const result = await client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5);

      expect(result).toBe(556);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "*(line 5)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps the error when the line comment fails with a non-422 status", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "owner\/repo"/);
    });

    it("returns 0 when the file-level fallback comment also fails with 422", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockRejectedValueOnce(httpError(422));

      const result = await client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts", 5);

      expect(result).toBe(0);
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("posts a file-level comment directly when no line is given", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 557 } });

      const result = await client.createPRReviewComment("owner/repo", 1, "body", "src/a.ts");

      expect(result).toBe(557);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to a review comment", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("owner/repo", 1, 555, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        comment_id: 555,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows failures and logs a warning instead of throwing", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));

      await expect(
        client.replyToReviewComment("owner/repo", 1, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(nonErrorHttpFailure(500));

      await expect(
        client.replyToReviewComment("owner/repo", 1, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "NonError(status=500)" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review successfully", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("owner/repo", 1, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "lgtm",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because it's the author's own PR", async () => {
      const { client, octokit, logger } = makeClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 1,
        body: "please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws (wrapped) when the own-PR fallback itself fails", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockRejectedValueOnce(new Error("fallback also failed"));

      await expect(
        client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow(/fallback also failed/);
    });

    it("throws a wrapped error for a COMMENT event failure (own-PR fallback never applies)", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Cannot request changes on your own pull request"),
      );

      await expect(client.submitPRReview("owner/repo", 1, "note", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed for "owner\/repo"/,
      );
    });

    it("throws a wrapped error for an unrelated failure message", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "owner\/repo"/);
    });

    it("stringifies a non-Error rejection when checking for the own-PR message", async () => {
      const { client, octokit } = makeClient();
      octokit.pulls.createReview.mockRejectedValue(nonErrorHttpFailure(500));

      await expect(
        client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "owner\/repo"/);
    });
  });
});
