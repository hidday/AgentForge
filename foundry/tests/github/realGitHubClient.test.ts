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

function makeApiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
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

function injectOctokit(client: RealGitHubClient, fake: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = fake;
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let octokit: FakeOctokit;
  let client: RealGitHubClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    octokit = makeFakeOctokit();
    injectOctokit(client, octokit);
  });

  describe("splitRepo validation", () => {
    it("rejects when repo string has no slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("octo/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "octo", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a descriptive error including original message on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("octo/repo")).rejects.toThrow(
        /cannot access repo "octo\/repo".*Not Found/,
      );
    });

    it("stringifies non-Error rejection reasons", async () => {
      octokit.repos.get.mockRejectedValue("some string failure");

      await expect(client.verifyRepoAccess("octo/repo")).rejects.toThrow(
        /Original: some string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("octo/repo")).resolves.toBe("develop");
    });

    it("wraps and throws on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("octo/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "octo\/repo": boom/,
      );
    });

    it("stringifies a non-Error rejection reason inside wrapError", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.getDefaultBranch("octo/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "octo\/repo": plain string failure/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's ref sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await expect(client.createBranch("octo/repo", "feature/x")).resolves.toBeUndefined();

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(makeApiError(422, "Reference already exists"));

      await expect(client.createBranch("octo/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps and throws on a non-422 failure, including the branch name in context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(makeApiError(500, "server error"));

      await expect(client.createBranch("octo/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "octo\/repo" \{"branchName":"feature\/x"\}: server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body");

      expect(prNumber).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        head: "feature/x",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws immediately on a 422 field-validation error without looking up existing PRs", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeApiError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("octo/repo", "feature/x", "no-such-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(octokit.pulls.list).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("treats a 422 'missing_field' error the same as field validation", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeApiError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("on a generic 422 (PR already exists), returns the existing open PR's number", async () => {
      octokit.pulls.create.mockRejectedValue(makeApiError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

      const prNumber = await client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body");

      expect(prNumber).toBe(99);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        head: "octo:feature/x",
        base: "main",
        state: "open",
      });
    });

    it("on a generic 422 with no existing open PR found, wraps and throws", async () => {
      octokit.pulls.create.mockRejectedValue(makeApiError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps and throws on a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(makeApiError(500, "server exploded"));

      await expect(
        client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*server exploded/);
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("handles a non-Error 422 rejection reason by stringifying it for the field-validation check", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("octo/repo", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      // Non-Error reasons stringify to "[object Object]", which contains neither
      // '"code":"invalid"' nor '"code":"missing_field"', so it falls through to
      // the "look up an existing PR" path rather than the field-validation path.
      expect(octokit.pulls.list).toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await expect(client.commentOnPR("octo/repo", 7, "hello")).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        issue_number: 7,
        body: "hello",
      });
    });

    it("wraps and throws on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("octo/repo", 7, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "octo\/repo" \{"prNumber":7\}: rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/f b/f\n+added line" });

      const diff = await client.getPRDiff("octo/repo", 7);

      expect(diff).toBe("diff --git a/f b/f\n+added line");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        mediaType: { format: "diff" },
      });
    });

    it("returns an empty string for an empty diff (boundary case)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "" });

      const diff = await client.getPRDiff("octo/repo", 7);
      expect(diff).toBe("");
    });

    it("wraps and throws on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("octo/repo", 7)).rejects.toThrow(
        /GitHub getPRDiff failed for "octo\/repo" \{"prNumber":7\}: not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await expect(client.markPRReady("octo/repo", 7)).resolves.toBeUndefined();
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({ markPullRequestReadyForReview: { pullRequest: { id: "node-1" } } });

      await expect(client.markPRReady("octo/repo", 7)).resolves.toBeUndefined();
      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps and throws when the get call fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("octo/repo", 7)).rejects.toThrow(
        /GitHub markPRReady failed for "octo\/repo" \{"prNumber":7\}: boom/,
      );
    });

    it("wraps and throws when the graphql mutation fails", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("mutation failed"));

      await expect(client.markPRReady("octo/repo", 7)).rejects.toThrow(
        /GitHub markPRReady failed.*mutation failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments to the PRComment shape on success", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "LGTM",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const comments = await client.listPRComments("octo/repo", 7);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "LGTM", createdAt: "2024-01-01T00:00:00Z" },
      ]);
    });

    it("defaults author to 'unknown' and body to '' when missing (boundary case)", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [{ id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" }],
      });

      const comments = await client.listPRComments("octo/repo", 7);

      expect(comments).toEqual([
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("returns an empty array when there are no comments (boundary case)", async () => {
      octokit.issues.listComments.mockResolvedValue({ data: [] });

      await expect(client.listPRComments("octo/repo", 7)).resolves.toEqual([]);
    });

    it("wraps and throws on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("octo/repo", 7)).rejects.toThrow(
        /GitHub listPRComments failed for "octo\/repo" \{"prNumber":7\}: boom/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment("octo/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha-1",
      });
    });

    it("creates a file-level comment directly when no line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 556 } });

      const id = await client.createPRReviewComment("octo/repo", 7, "general nit", "src/a.ts");

      expect(id).toBe(556);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        body: "general nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line-level comment 422s (line not in diff)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(makeApiError(422, "Line not in diff"))
        .mockResolvedValueOnce({ data: { id: 557 } });

      const id = await client.createPRReviewComment("octo/repo", 7, "nit", "src/a.ts", 10);

      expect(id).toBe(557);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level error, wrapped by the outer catch", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(makeApiError(500, "server exploded"));

      await expect(
        client.createPRReviewComment("octo/repo", 7, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server exploded/);
    });

    it("returns 0 and logs a warning when the initial pulls.get call 422s", async () => {
      octokit.pulls.get.mockRejectedValue(makeApiError(422, "file not in diff"));

      const id = await client.createPRReviewComment("octo/repo", 7, "nit", "src/missing.ts", 10);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps and throws on a non-422 failure fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("octo/repo", 7, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*boom/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await expect(
        client.replyToReviewComment("octo/repo", 7, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        comment_id: 555,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("octo/repo", 7, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        expect.stringContaining("Failed to reply"),
      );
    });

    it("stringifies non-Error rejection reasons when logging the warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("weird failure");

      await expect(
        client.replyToReviewComment("octo/repo", 7, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "weird failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await expect(
        client.submitPRReview("octo/repo", 7, "LGTM", "APPROVE"),
      ).resolves.toBeUndefined();
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when REQUEST_CHANGES fails because it's the user's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("octo/repo", 7, "Please fix", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "octo",
        repo: "repo",
        pull_number: 7,
        body: "Please fix",
        event: "COMMENT",
      });
    });

    it("rethrows (wrapped) when the own-PR fallback does not apply because event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("octo/repo", 7, "Just a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps and throws for unrelated failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(
        client.submitPRReview("octo/repo", 7, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*service unavailable/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("handles a non-Error rejection reason when checking for the own-PR fallback message", async () => {
      octokit.pulls.createReview.mockRejectedValue({ weird: "failure" });

      await expect(
        client.submitPRReview("octo/repo", 7, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      // Stringifying a non-Error reason doesn't match the own-PR regex, so it
      // should not retry with a COMMENT fallback.
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
