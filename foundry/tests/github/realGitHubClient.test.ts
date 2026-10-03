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

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    const ctx = makeClient();
    client = ctx.client;
    octokit = ctx.octokit;
    logger = ctx.logger;
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is reachable", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "owner", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a descriptive error with cause when the API call fails", async () => {
      const original = new Error("Not Found");
      octokit.repos.get.mockRejectedValue(original);

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toMatchObject({
        message: expect.stringContaining('cannot access repo "owner/repo"') as unknown as string,
        cause: original,
      });
    });

    it("throws for a malformed repo string (no slash)", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo"',
      );
    });

    it("stringifies a non-Error rejection (e.g. a plain string) in the error detail", async () => {
      octokit.repos.get.mockRejectedValue("just a string failure");

      await expect(client.verifyRepoAccess("owner/repo")).rejects.toThrow(
        "Original: just a string failure",
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("develop");
    });

    it("wraps the error on failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("owner/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "owner/repo"',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({ data: {} });

      await client.createBranch("owner/repo", "ai/feature-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/ai/feature-1",
        sha: "abc123",
      });
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(statusError(422));

      await expect(client.createBranch("owner/repo", "ai/feature-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "owner/repo", branchName: "ai/feature-1" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps and throws for non-422 errors", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("owner/repo", "ai/feature-1")).rejects.toThrow(
        'GitHub createBranch failed for "owner/repo"',
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(55);
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

    it("throws (without looking up existing PRs) on a 422 field-validation error", async () => {
      const err = statusError(422, '{"code":"invalid","field":"base"}');
      octokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("owner/repo", "head", "bad-base", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
      expect(octokit.pulls.list).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR when creation 422s for a non-field reason", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        head: "owner:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when 422s for a non-field reason but no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("boom"));

      await expect(
        client.createDraftPR("owner/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow('GitHub createDraftPR failed for "owner/repo"');
    });

    it("treats a non-Error 422 rejection as non-field-validation and looks up the existing PR", async () => {
      octokit.pulls.create.mockRejectedValue(statusError(422));
      // Overwrite with a plain object carrying only `status`, no message, to
      // exercise the `err instanceof Error ? ... : String(err)` false branch.
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const result = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

      expect(result).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokit.issues.createComment.mockResolvedValue({ data: {} });

      await client.commentOnPR("owner/repo", 10, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("fail"));

      await expect(client.commentOnPR("owner/repo", 10, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "owner/repo"',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff string", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("owner/repo", 10)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("fail"));

      await expect(client.getPRDiff("owner/repo", 10)).rejects.toThrow(
        'GitHub getPRDiff failed for "owner/repo"',
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing if the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("owner/repo", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the GraphQL mutation to mark a draft PR ready", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("owner/repo", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview") as unknown as string, {
        prId: "node-1",
      });
    });

    it("wraps errors from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("fail"));

      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo"',
      );
    });

    it("wraps errors from the graphql mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql fail"));

      await expect(client.markPRReady("owner/repo", 10)).rejects.toThrow(
        'GitHub markPRReady failed for "owner/repo"',
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author to 'unknown' and missing body to ''", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
        ],
      });

      const result = await client.listPRComments("owner/repo", 10);

      expect(result).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("fail"));

      await expect(client.listPRComments("owner/repo", 10)).rejects.toThrow(
        'GitHub listPRComments failed for "owner/repo"',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts", 5);

      expect(id).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts");

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line-level call 422s", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const id = await client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts", 5);

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "*(line 5)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns 0 and logs a warning when the top-level call 422s with no fallback applicable", async () => {
      octokit.pulls.get.mockRejectedValue(statusError(422));

      const id = await client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts", 5);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("propagates non-422 errors from the line-level attempt by wrapping them", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts", 5),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });

    it("wraps non-422 errors from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("owner/repo", 10, "body", "src/a.ts"),
      ).rejects.toThrow('GitHub createPRReviewComment failed for "owner/repo"');
    });
  });

  describe("replyToReviewComment", () => {
    it("posts the reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

      await client.replyToReviewComment("owner/repo", 10, 500, "reply body");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        comment_id: 500,
        body: "reply body",
      });
    });

    it("swallows errors and only logs a warning (never throws)", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("fail"));

      await expect(
        client.replyToReviewComment("owner/repo", 10, 500, "reply body"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({ data: {} });

      await client.submitPRReview("owner/repo", 10, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({ data: {} });

      await client.submitPRReview("owner/repo", 10, "Needs fixes", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "owner",
        repo: "repo",
        pull_number: 10,
        body: "Needs fixes",
        event: "COMMENT",
      });
    });

    it("does not retry when event is already COMMENT, even on the same error text", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(client.submitPRReview("owner/repo", 10, "note", "COMMENT")).rejects.toThrow(
        'GitHub submitPRReview failed for "owner/repo"',
      );
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps errors that don't match the own-PR fallback message", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("totally different failure"));

      await expect(
        client.submitPRReview("owner/repo", 10, "note", "REQUEST_CHANGES"),
      ).rejects.toThrow('GitHub submitPRReview failed for "owner/repo"');
    });
  });
});
