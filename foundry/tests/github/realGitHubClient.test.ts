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

function withFakeOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeFakeOctokit();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    withFakeOctokit(client, octokit);
  });

  describe("splitRepo validation", () => {
    it("rejects a repo string with no slash", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with guidance when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*GITHUB_TOKEN.*Not Found/s,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default branch", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors with the operation name and repo", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": rate limited',
      );
    });

    it("stringifies a non-Error rejection in wrapError", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": plain string failure',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch's HEAD sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
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
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 from createRef as the branch already existing and resolves", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps non-422 errors with the branch name as context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("ref lookup failed"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets" \{"branchName":"ai\/issue-1"\}: ref lookup failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body",
      );

      expect(prNumber).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "ai/issue-1",
        base: "main",
        title: "Fix bug",
        body: "Body",
        draft: true,
      });
    });

    it("throws when a 422 is a field validation error (invalid base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "no-such-base", "Fix bug", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body",
      );

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:ai/issue-1",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 message reports a missing_field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("throws when the 422 lookup finds no existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws immediately for a non-422 error", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on the PR's issue thread", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 42, "Looks good");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 42,
        body: "Looks good",
      });
    });

    it("wraps errors with the PR number as context", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("403 forbidden"));

      await expect(client.commentOnPR("acme/widgets", 42, "Looks good")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets" \{"prNumber":42\}: 403 forbidden/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x\n+added" });

      const diff = await client.getPRDiff("acme/widgets", 42);

      expect(diff).toBe("diff --git a/x b/x\n+added");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 42)).rejects.toThrow(
        /GitHub getPRDiff failed/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR as ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps errors from the GraphQL call", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql failure"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed.*graphql failure/,
      );
    });

    it("wraps errors from fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments and defaults missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 42)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-abc" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "nit: rename this",
        "src/index.ts",
        10,
      );

      expect(commentId).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "nit: rename this",
        path: "src/index.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha-abc",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-abc" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "nit: rename this",
        "src/index.ts",
        10,
      );

      expect(commentId).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "*(line 10)* nit: rename this",
        path: "src/index.ts",
        subject_type: "file",
        commit_id: "sha-abc",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-abc" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 503 } });

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "file level note",
        "src/index.ts",
      );

      expect(commentId).toBe(503);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "file level note",
        path: "src/index.ts",
        subject_type: "file",
        commit_id: "sha-abc",
      });
    });

    it("returns 0 and warns when the outer call ultimately fails with 422", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422));

      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "note",
        "src/index.ts",
        10,
      );

      expect(commentId).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level error wrapped by the outer catch", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-abc" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network blip"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "note", "src/index.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*network blip/);
    });

    it("wraps a non-422 error from fetching the PR", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "note", "src/index.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to the review comment", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 42, 501, "thanks!");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        comment_id: 501,
        body: "thanks!",
      });
    });

    it("swallows errors and only logs a warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection when logging the warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 42, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "needs work",
        event: "COMMENT",
      });
    });

    it("does not fall back when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 42, "a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error for unrelated failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("server error"));

      await expect(
        client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("stringifies a non-Error rejection before pattern-matching the fallback condition", async () => {
      octokit.pulls.createReview.mockRejectedValue("plain string failure");

      await expect(
        client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets" {"prNumber":42,"event":"APPROVE"}: plain string failure');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
