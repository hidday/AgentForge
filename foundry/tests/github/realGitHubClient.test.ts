import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOctokit = vi.hoisted(() => ({
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
  Octokit: vi.fn().mockImplementation(() => mockOctokit),
}));

import { Octokit } from "@octokit/rest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("token-abc", logger as never);
  });

  it("constructs the underlying Octokit with the given auth token", () => {
    expect(Octokit).toHaveBeenCalledWith({ auth: "token-abc" });
  });

  describe("verifyRepoAccess", () => {
    it("rejects synchronously with a format error for a malformed repo string", async () => {
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        'Invalid repo format "not-a-repo", expected "owner/repo"',
      );
    });

    it("resolves and logs debug on success", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("wraps a failure with a descriptive, actionable error", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        'GitHub: cannot access repo "acme/widgets". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
      );
    });

    it("stringifies a non-Error rejection", async () => {
      mockOctokit.repos.get.mockRejectedValue("network down");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        "Original: network down",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "trunk" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("trunk");
    });

    it("wraps failures with operation context", async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": rate limited',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("acme/widgets", "feature-x");

      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/feature-x",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature-x" },
        "Created branch on GitHub",
      );
    });

    it("treats a 422 as the branch already existing and continues without throwing", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      mockOctokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/widgets", "feature-x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature-x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps any other failure", async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      mockOctokit.git.getRef.mockRejectedValue(httpError(500, "server exploded"));

      await expect(client.createBranch("acme/widgets", "feature-x")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets" {"branchName":"feature-x"}: server exploded',
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      mockOctokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const num = await client.createDraftPR("acme/widgets", "head", "main", "T", "B");

      expect(num).toBe(7);
      expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "head",
        base: "main",
        title: "T",
        body: "B",
        draft: true,
      });
    });

    it("throws a wrapped error for a 422 field-validation failure (invalid code)", async () => {
      const err = httpError(422, '{"code":"invalid","field":"base"}');
      mockOctokit.pulls.create.mockRejectedValue(err);

      await expect(client.createDraftPR("acme/widgets", "head", "bogus", "T", "B")).rejects.toThrow(
        'GitHub createDraftPR failed for "acme/widgets"',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error for a 422 field-validation failure (missing_field code)", async () => {
      const err = httpError(422, '{"code":"missing_field"}');
      mockOctokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("acme/widgets", "head", "bogus", "T", "B"),
      ).rejects.toThrow('GitHub createDraftPR failed');
    });

    it("treats a non-Error 422 rejection as non-field-validation and looks up the existing PR", async () => {
      const nonErrorRejection = { status: 422 };
      mockOctokit.pulls.create.mockRejectedValue(nonErrorRejection);
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 61 }] });

      const num = await client.createDraftPR("acme/widgets", "head", "main", "T", "B");

      expect(num).toBe(61);
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const num = await client.createDraftPR("acme/widgets", "head", "main", "T", "B");

      expect(num).toBe(55);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:head",
        base: "main",
        state: "open",
      });
    });

    it("throws wrapped error when a 422 duplicate lookup finds no existing PR", async () => {
      mockOctokit.pulls.create.mockRejectedValue(httpError(422, "pull request already exists"));
      mockOctokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "T", "B"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("throws wrapped error for a non-422 failure", async () => {
      mockOctokit.pulls.create.mockRejectedValue(new Error("network error"));

      await expect(
        client.createDraftPR("acme/widgets", "head", "main", "T", "B"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets" {"head":"head","base":"main"}: network error');
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      mockOctokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("acme/widgets", 5, "hi");

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 5,
        body: "hi",
      });
    });

    it("wraps a failure with the PR number", async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("acme/widgets", 5, "hi")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":5}: boom',
      );
    });

    it("wraps a non-Error rejection by stringifying it", async () => {
      mockOctokit.issues.createComment.mockRejectedValue("weird failure");

      await expect(client.commentOnPR("acme/widgets", 5, "hi")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets" {"prNumber":5}: weird failure',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("acme/widgets", 9)).resolves.toBe("diff --git a b");
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 9,
        mediaType: { format: "diff" },
      });
    });

    it("wraps a failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.getPRDiff("acme/widgets", 9)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/widgets" {"prNumber":9}: gone',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_kwabc" } });
      mockOctokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 3);

      expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_kwabc",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 3 },
        "Marked PR as ready for review",
      );
    });

    it("does nothing when the PR is already not a draft", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_x" } });

      await client.markPRReady("acme/widgets", 3);

      expect(mockOctokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps a failure", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("no such PR"));

      await expect(client.markPRReady("acme/widgets", 3)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets" {"prNumber":3}: no such PR',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hello", created_at: "2024-01-01" },
          { id: 2, user: null, body: null, created_at: "2024-01-02" },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 4);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2024-01-01" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02" },
      ]);
    });

    it("wraps a failure", async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error("denied"));

      await expect(client.listPRComments("acme/widgets", 4)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/widgets" {"prNumber":4}: denied',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is provided", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 200 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        11,
        "nit",
        "src/a.ts",
        12,
      );

      expect(id).toBe(200);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        body: "nit",
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 201 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        11,
        "nit",
        "src/a.ts",
        12,
      );

      expect(id).toBe(201);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        body: "*(line 12)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 11, path: "src/a.ts", line: 12 },
        "Line not in PR diff, falling back to file-level comment",
      );
    });

    it("re-throws a non-422 line-comment error to the outer handler and wraps it", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValue(new Error("unexpected"));

      await expect(
        client.createPRReviewComment("acme/widgets", 11, "nit", "src/a.ts", 12),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });

    it("creates a file-level comment directly when no line is given", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha2" } } });
      mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 300 } });

      const id = await client.createPRReviewComment("acme/widgets", 11, "general note", "src/b.ts");

      expect(id).toBe(300);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        body: "general note",
        path: "src/b.ts",
        subject_type: "file",
        commit_id: "sha2",
      });
    });

    it("returns 0 and logs a warning when the whole operation 422s (no line)", async () => {
      mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha2" } } });
      mockOctokit.pulls.createReviewComment.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("acme/widgets", 11, "note", "src/b.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 11, path: "src/b.ts", line: undefined },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("returns 0 when fetching the PR itself 422s", async () => {
      mockOctokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("acme/widgets", 11, "note", "src/b.ts");

      expect(id).toBe(0);
    });

    it("wraps a non-422 failure fetching the PR", async () => {
      mockOctokit.pulls.get.mockRejectedValue(new Error("fetch failed"));

      await expect(
        client.createPRReviewComment("acme/widgets", 11, "note", "src/b.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply successfully", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("acme/widgets", 11, 500, "thanks");

      expect(mockOctokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        comment_id: 500,
        body: "thanks",
      });
    });

    it("swallows failures and logs a warning instead of throwing", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 11, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 11, commentId: 500, error: "comment gone" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the logged warning", async () => {
      mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");

      await client.replyToReviewComment("acme/widgets", 11, 500, "thanks");

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 11, commentId: 500, error: "plain string failure" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      mockOctokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("acme/widgets", 11, "lgtm", "APPROVE");

      expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub refuses a self-authored REQUEST_CHANGES review", async () => {
      mockOctokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("acme/widgets", 11, "hmm", "REQUEST_CHANGES");

      expect(mockOctokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 11,
        body: "hmm",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 11, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("does not fall back when the event is already COMMENT, even if the message matches", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(
        new Error("cannot request changes on own pull request"),
      );

      await expect(client.submitPRReview("acme/widgets", 11, "hmm", "COMMENT")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":11,"event":"COMMENT"}',
      );
      expect(mockOctokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps a failure whose message does not match the self-review pattern", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(client.submitPRReview("acme/widgets", 11, "hmm", "APPROVE")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":11,"event":"APPROVE"}: service unavailable',
      );
    });

    it("treats a non-Error rejection as not matching the self-review pattern and wraps it", async () => {
      mockOctokit.pulls.createReview.mockRejectedValue({ weird: "object" });

      await expect(client.submitPRReview("acme/widgets", 11, "hmm", "REQUEST_CHANGES")).rejects.toThrow(
        'GitHub submitPRReview failed for "acme/widgets" {"prNumber":11,"event":"REQUEST_CHANGES"}: [object Object]',
      );
    });
  });
});
