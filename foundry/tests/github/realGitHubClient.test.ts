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

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** Builds a fresh fake Octokit instance with every method the client calls stubbed out. */
function makeFakeOctokit() {
  return {
    repos: {
      get: vi.fn(),
    },
    git: {
      getRef: vi.fn(),
      createRef: vi.fn(),
    },
    pulls: {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      createReviewComment: vi.fn(),
      createReplyForReviewComment: vi.fn(),
      createReview: vi.fn(),
    },
    issues: {
      createComment: vi.fn(),
      listComments: vi.fn(),
    },
    graphql: vi.fn(),
  };
}

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function withFakeOctokit(client: RealGitHubClient, fake: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = fake;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    octokit = makeFakeOctokit();
    withFakeOctokit(client, octokit);
  });

  describe("splitRepo validation (shared across methods)", () => {
    it("rejects a repo string with no slash before calling the API", async () => {
      await expect(client.getDefaultBranch("invalid-repo-format")).rejects.toThrow(
        /Invalid repo format "invalid-repo-format", expected "owner\/repo"/,
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo" },
        "Verified GitHub repo access",
      );
    });

    it("wraps the error with a permissions hint when the API call fails", async () => {
      octokit.repos.get.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        /GitHub: cannot access repo "owner\/repo"\. Check that GITHUB_TOKEN has repository access permissions\. Original: Not Found/,
      );
    });

    it("stringifies a non-Error throwable", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(/plain string failure/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps a 5xx error", async () => {
      octokit.repos.get.mockRejectedValue(httpError(500, "Internal Server Error"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo": Internal Server Error/,
      );
    });

    it("wraps a rate-limit (403) error", async () => {
      octokit.repos.get.mockRejectedValue(httpError(403, "API rate limit exceeded"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo": API rate limit exceeded/,
      );
    });

    it("stringifies a non-Error throwable via wrapError", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "owner\/repo": plain string failure/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates the ref from the default branch's sha and logs on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await expect(client.createBranch("owner/repo", "ai/feature")).resolves.toBeUndefined();

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/feature" },
        "Created branch on GitHub",
      );
    });

    it("treats a 422 (branch already exists) as success and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("owner/repo", "ai/feature")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/feature" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps a non-422 error with branchName context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.createBranch("owner/repo", "ai/feature")).rejects.toThrow(
        /GitHub createBranch failed for "owner\/repo" \{"branchName":"ai\/feature"\}: Not Found/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a PR and returns its number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).resolves.toBe(55);

      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "head-branch",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 55 },
        "Created draft PR on GitHub",
      );
    });

    it("throws on a 422 field-validation error (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);

      expect(logger.error).toHaveBeenCalled();
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("throws on a 422 missing_field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("treats a 422 thrown as a non-Error object as a duplicate-head lookup (message stringified)", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422, toString: () => "weird 422 object" });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).resolves.toBe(88);
    });

    it("falls back to the existing open PR when 422 is a duplicate-head-branch error", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).resolves.toBe(77);

      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head-branch",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 77 },
        "Found existing open PR",
      );
    });

    it("throws when 422 duplicate-head lookup finds no existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo"/);
    });

    it("wraps a non-422 error directly", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(500, "Internal Server Error"));

      await expect(
        client.createDraftPR("owner/repo", "head-branch", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "owner\/repo".*Internal Server Error/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await expect(client.commentOnPR("owner/repo", 10, "hello")).resolves.toBeUndefined();

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps an error with the PR number as context", async () => {
      octokit.issues.createComment.mockRejectedValue(httpError(403, "Forbidden"));

      await expect(client.commentOnPR("owner/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "owner\/repo" \{"prNumber":10\}: Forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("owner/repo", 10)).resolves.toBe("diff --git a b");

      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        mediaType: { format: "diff" },
      });
    });

    it("wraps an error", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.getPRDiff("owner/repo", 10)).rejects.toThrow(
        /GitHub getPRDiff failed for "owner\/repo"/,
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql and logs", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node_1" } });
      octokit.graphql.mockResolvedValue({ markPullRequestReadyForReview: { pullRequest: {} } });

      await expect(client.markPRReady("owner/repo", 10)).resolves.toBeUndefined();

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_node_1",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10 },
        "Marked PR as ready for review",
      );
    });

    it("is a no-op when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_node_1" } });

      await expect(client.markPRReady("owner/repo", 10)).resolves.toBeUndefined();

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps an error from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed for "owner\/repo"/,
      );
    });

    it("wraps an error from the graphql mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node_1" } });
      octokit.graphql.mockRejectedValue(new Error("GraphQL error: something went wrong"));

      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        /GitHub markPRReady failed for "owner\/repo".*GraphQL error/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comment fields on success, falling back for missing user/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "looks good",
            created_at: "2026-01-01T00:00:00Z",
          },
          {
            id: 2,
            user: null,
            body: null,
            created_at: "2026-01-02T00:00:00Z",
          },
        ],
      });

      const comments = await client.listPRComments("owner/repo", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "looks good", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps an error", async () => {
      octokit.issues.listComments.mockRejectedValue(httpError(500, "Server Error"));

      await expect(client.listPRComments("owner/repo", 10)).rejects.toThrow(
        /GitHub listPRComments failed for "owner\/repo"/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 999 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "fix this", "src/a.ts", 5);

      expect(id).toBe(999);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "fix this",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 1000 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "fix this", "src/a.ts");

      expect(id).toBe(1000);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line must be part of the diff"))
        .mockResolvedValueOnce({ data: { id: 1234 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "fix this", "src/a.ts", 5);

      expect(id).toBe(1234);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* fix this",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, path: "src/a.ts", line: 5 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("rethrows a non-422 line-comment error, which the outer catch wraps", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(500, "Server Error"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "fix this", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "owner\/repo"/);
    });

    it("returns 0 and logs a warning when the outer call fails with 422 (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422, "file not part of pull request"));

      const id = await client.createPRReviewComment("owner/repo", 10, "fix this", "src/missing.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, path: "src/missing.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 outer failure (e.g. pulls.get failing)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(500, "Server Error"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "fix this", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "owner\/repo"/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies and logs on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await expect(
        client.replyToReviewComment("owner/repo", 10, 1234, "thanks"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        comment_id: 1234,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, commentId: 1234 },
        "Replied to PR review comment",
      );
    });

    it("swallows the error and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(httpError(404, "Not Found"));

      await expect(
        client.replyToReviewComment("owner/repo", 10, 1234, "thanks"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, commentId: 1234, error: "Not Found" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error throwable in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("boom");

      await client.replyToReviewComment("owner/repo", 10, 1234, "thanks");

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, commentId: 1234, error: "boom" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await expect(
        client.submitPRReview("owner/repo", 10, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "lgtm",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, event: "APPROVE" },
        "Submitted PR review",
      );
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(
          httpError(422, "Cannot request changes on your own pull request"),
        )
        .mockResolvedValueOnce({ data: {} });

      await expect(
        client.submitPRReview("owner/repo", 10, "please fix", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 10, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("does not fall back when the event is already COMMENT, even with the matching message", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        httpError(422, "Cannot request changes on your own pull request"),
      );

      await expect(client.submitPRReview("owner/repo", 10, "fyi", "COMMENT")).rejects.toThrow(
        /GitHub submitPRReview failed for "owner\/repo"/,
      );

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps an unrelated error", async () => {
      octokit.pulls.createReview.mockRejectedValue(httpError(500, "Internal Server Error"));

      await expect(
        client.submitPRReview("owner/repo", 10, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "owner\/repo"/);
    });

    it("stringifies a non-Error throwable when checking for the own-PR fallback message", async () => {
      octokit.pulls.createReview.mockRejectedValue("plain string failure");

      await expect(
        client.submitPRReview("owner/repo", 10, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "owner\/repo".*plain string failure/);
    });
  });
});
