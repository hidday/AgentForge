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

function withFakeOctokit(client: RealGitHubClient, fake: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = fake;
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let octokit: FakeOctokit;
  let client: RealGitHubClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    octokit = makeFakeOctokit();
    withFakeOctokit(client, octokit);
  });

  describe("repo format validation", () => {
    it("rejects a repo string without a slash", async () => {
      await expect(client.verifyRepoAccess("no-slash")).rejects.toThrow(
        'Invalid repo format "no-slash"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with a helpful message when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Not Found/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps a failure", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));
      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*rate limited/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref off the default branch", async () => {
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
    });

    it("treats a 422 (already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps a non-422 failure", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("network down"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets".*network down/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates the PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(7);
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

    it("throws on a 422 field validation error (e.g. missing base branch)", async () => {
      const err = httpError(422, '{"code":"invalid","field":"base"}');
      octokit.pulls.create.mockRejectedValue(err);

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("on a generic 422, looks up and returns the existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(55);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:ai/issue-1",
        base: "main",
        state: "open",
      });
    });

    it("throws when a 422 occurs but no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("server error"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*server error/);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});
      await client.commentOnPR("acme/widgets", 3, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 3,
        body: "hello",
      });
    });

    it("wraps a failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("nope"));
      await expect(client.commentOnPR("acme/widgets", 3, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed.*nope/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("acme/widgets", 3)).resolves.toBe("diff --git a b");
    });

    it("wraps a failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.getPRDiff("acme/widgets", 3)).rejects.toThrow(
        /GitHub getPRDiff failed.*nope/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false } });
      await client.markPRReady("acme/widgets", 3);
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_node" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 3);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_node",
      });
    });

    it("wraps a failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.markPRReady("acme/widgets", 3)).rejects.toThrow(
        /GitHub markPRReady failed.*nope/,
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

      const comments = await client.listPRComments("acme/widgets", 3);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps a failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("nope"));
      await expect(client.listPRComments("acme/widgets", 3)).rejects.toThrow(
        /GitHub listPRComments failed.*nope/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 900 } });

      const id = await client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts", 12);

      expect(id).toBe(900);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        body: "nit",
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 901 } });

      const id = await client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts", 12);

      expect(id).toBe(901);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        body: "*(line 12)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level error, which is then wrapped", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts", 12),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/);
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 902 } });

      const id = await client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts");

      expect(id).toBe(902);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and warns when the outer call fails with 422 (file not in diff)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422));

      const id = await client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 outer failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("acme/widgets", 3, "nit", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*boom/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await client.replyToReviewComment("acme/widgets", 3, 900, "thanks");
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        comment_id: 900,
        body: "thanks",
      });
    });

    it("swallows a failure and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
      await expect(
        client.replyToReviewComment("acme/widgets", 3, 900, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("acme/widgets", 3, "lgtm", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 3, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 3,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps a failure unrelated to the own-PR restriction", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("server error"));

      await expect(
        client.submitPRReview("acme/widgets", 3, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*server error/);
    });

    it("wraps the own-PR restriction message when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 3, "lgtm", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });
  });
});
