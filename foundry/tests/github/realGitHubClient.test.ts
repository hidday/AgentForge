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

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("fake-token", logger as never);
    octokit = makeFakeOctokit();
    (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  });

  describe("repo format validation", () => {
    it("rejects with an Invalid repo format error when there is no slash", async () => {
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        'Invalid repo format "not-a-repo", expected "owner/repo"',
      );
    });

    it("rejects when the repo part is missing after the slash", async () => {
      await expect(client.verifyRepoAccess("owner/")).rejects.toThrow("Invalid repo format");
    });
  });

  describe("verifyRepoAccess", () => {
    it("calls repos.get with the split owner/repo and resolves on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the underlying error with a GitHub-token-permission hint", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        'GitHub: cannot access repo "acme/widgets". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
      );
    });

    it("stringifies a non-Error rejection in the wrapped message", async () => {
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        "Original: boom",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
    });

    it("wraps errors as a getDefaultBranch failure", async () => {
      octokit.repos.get.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "acme/widgets": Not Found',
      );
    });
  });

  describe("createBranch", () => {
    it("reads the default branch ref and creates the new ref from its sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "ai/feature-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/ai/feature-1",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 from createRef as 'branch already exists' and resolves without throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "ai/feature-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps a non-422 error from createRef as a createBranch failure", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(new Error("rate limited"));

      await expect(client.createBranch("acme/widgets", "ai/feature-1")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets"',
      );
    });

    it("wraps an error from the initial repos.get lookup", async () => {
      octokit.repos.get.mockRejectedValue(new Error("down"));

      await expect(client.createBranch("acme/widgets", "ai/feature-1")).rejects.toThrow(
        'GitHub createBranch failed for "acme/widgets"',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/feature-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(42);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "ai/feature-1",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/feature-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 missing_field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/feature-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("looks up and returns an existing open PR when creation 422s for a duplicate head", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/feature-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:ai/feature-1",
        base: "main",
        state: "open",
      });
    });

    it("throws a wrapped error when the 422 duplicate lookup finds no existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/feature-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("wraps a non-422 error from pulls.create", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network error"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/feature-1", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "acme/widgets"');
    });

    it("treats a non-Error 422 rejection as a duplicate-head lookup (message stringifies, no code match)", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/feature-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment on the PR", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 42, "hello world");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 42,
        body: "hello world",
      });
    });

    it("wraps an error from issues.createComment", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("acme/widgets", 42, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "acme/widgets"',
      );
    });

    it("stringifies a non-Error rejection when wrapping the error", async () => {
      octokit.issues.createComment.mockRejectedValue({ status: 500 });

      await expect(client.commentOnPR("acme/widgets", 42, "hello")).rejects.toThrow(
        "[object Object]",
      );
    });
  });

  describe("getPRDiff", () => {
    it("requests the diff media type and returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      const diff = await client.getPRDiff("acme/widgets", 42);

      expect(diff).toBe("diff --git a/x b/x");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        mediaType: { format: "diff" },
      });
    });

    it("wraps an error from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(404, "Not Found"));

      await expect(client.getPRDiff("acme/widgets", 42)).rejects.toThrow(
        'GitHub getPRDiff failed for "acme/widgets"',
      );
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 42);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps an error from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets"',
      );
    });

    it("wraps an error from the graphql mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql failure"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        'GitHub markPRReady failed for "acme/widgets"',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps API comments into the PRComment shape", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "looks good",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "looks good", createdAt: "2024-01-01T00:00:00Z" },
      ]);
      expect(octokit.issues.listComments).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 42,
      });
    });

    it("falls back to 'unknown' author and empty body when missing", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [{ id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" }],
      });

      const comments = await client.listPRComments("acme/widgets", 42);

      expect(comments).toEqual([
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps an error from issues.listComments", async () => {
      octokit.issues.listComments.mockRejectedValue(httpError(403, "Forbidden"));

      await expect(client.listPRComments("acme/widgets", 42)).rejects.toThrow(
        'GitHub listPRComments failed for "acme/widgets"',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment on the RIGHT side using the PR head sha", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 555 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "nit",
        "src/a.ts",
        10,
      );

      expect(id).toBe(555);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha-1",
      });
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 556 } });

      const id = await client.createPRReviewComment("acme/widgets", 42, "nit", "src/a.ts");

      expect(id).toBe(556);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 557 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "nit",
        "src/a.ts",
        10,
      );

      expect(id).toBe(557);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha-1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns 0 when a line-level comment fails for a reason other than a 422 line issue twice (outer catch 422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      // Both attempts (line-level, then file-level fallback) 422.
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "still invalid"));

      const id = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "nit",
        "src/a.ts",
        10,
      );

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows and wraps a non-422 error raised while posting the line-level comment", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("network error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "nit", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });

    it("returns 0 when the file-level (no line) comment fails with a 422", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "file not in diff"));

      const id = await client.createPRReviewComment("acme/widgets", 42, "nit", "src/a.ts");

      expect(id).toBe(0);
    });

    it("wraps a non-422 error from the initial pulls.get lookup", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "nit", "src/a.ts", 10),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "acme/widgets"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply to the review comment", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 42, 555, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        comment_id: 555,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows errors, logs a warning, and resolves without throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment gone" }),
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the logged warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("comment deleted");

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 555, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 42, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to a COMMENT review when REQUEST_CHANGES is rejected for being the PR author", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Cannot request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 42, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "Needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not fall back when the event is already COMMENT, even if the message matches", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Cannot request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 42, "Needs work", "COMMENT"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps an unrelated error without falling back", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("acme/widgets", 42, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("stringifies a non-Error rejection and does not match the own-PR fallback regex", async () => {
      octokit.pulls.createReview.mockRejectedValue({ status: 500 });

      await expect(
        client.submitPRReview("acme/widgets", 42, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "acme/widgets"');
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
