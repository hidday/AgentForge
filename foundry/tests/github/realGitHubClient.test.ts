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

function statusError(message: string, status: number): Error {
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

function injectFakeOctokit(client: RealGitHubClient, fake: FakeOctokit): void {
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
    injectFakeOctokit(client, octokit);
  });

  describe("repo format validation", () => {
    it("throws without calling the API when repo is not 'owner/repo'", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

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

    it("stringifies a non-Error rejection value in the wrapped message", async () => {
      octokit.repos.get.mockRejectedValue("plain string failure");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*plain string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors from the API", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*boom/,
      );
    });

    it("stringifies a non-Error rejection value via wrapError", async () => {
      octokit.repos.get.mockRejectedValue({ oddShape: true });

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*\[object Object\]/,
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
      octokit.git.createRef.mockRejectedValue(statusError("Reference already exists", 422));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("rethrows a wrapped error for non-422 failures", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(statusError("server error", 500));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets"/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(prNumber).toBe(55);
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

    it("throws a wrapped error on 422 field validation failures", async () => {
      octokit.pulls.create.mockRejectedValue(
        statusError('Validation Failed: {"code":"invalid","field":"base"}', 422),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "bad-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a generic 422 (PR already exists)", async () => {
      octokit.pulls.create.mockRejectedValue(statusError("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
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

    it("rethrows wrapped error on 422 when no existing open PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(statusError("A pull request already exists", 422));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
    });

    it("rethrows wrapped error for non-422 failures", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets".*network down/);
    });

    it("handles a non-Error 422 rejection value when checking for field validation", async () => {
      octokit.pulls.create.mockRejectedValue({ status: 422 });
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
    });
  });

  describe("commentOnPR", () => {
    it("posts the comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 10, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 10,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));

      await expect(client.commentOnPR("acme/widgets", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets".*rate limited/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff payload", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("acme/widgets", 10)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 10)).rejects.toThrow(
        /GitHub getPRDiff failed for "acme\/widgets".*not found/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 10);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 10);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("acme/widgets", 10)).rejects.toThrow(
        /GitHub markPRReady failed for "acme\/widgets".*boom/,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "first",
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: 2,
            user: null,
            body: null,
            created_at: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 10);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "first", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 10)).rejects.toThrow(
        /GitHub listPRComments failed for "acme\/widgets".*boom/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "nit",
        "src/a.ts",
        5,
      );

      expect(id).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "nit",
        path: "src/a.ts",
        line: 5,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(statusError("line not in diff", 422))
        .mockResolvedValueOnce({ data: { id: 501 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        10,
        "nit",
        "src/a.ts",
        5,
      );

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "*(line 5)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const id = await client.createPRReviewComment("acme/widgets", 10, "nit", "src/a.ts");

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the outer call fails with a 422", async () => {
      octokit.pulls.get.mockRejectedValue(statusError("file not in diff", 422));

      const id = await client.createPRReviewComment("acme/widgets", 10, "nit", "src/a.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a wrapped error for non-422 outer failures", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "nit", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*server error/);
    });

    it("rethrows non-422 failures from the line-level attempt without falling back", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("weird failure"));

      await expect(
        client.createPRReviewComment("acme/widgets", 10, "nit", "src/a.ts", 5),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*weird failure/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts the reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 10, 500, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        comment_id: 500,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment gone" }),
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection value when logging the warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("transient failure");

      await expect(
        client.replyToReviewComment("acme/widgets", 10, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "transient failure" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 10, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when GitHub refuses REQUEST_CHANGES on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 10, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 10,
        body: "needs work",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("rethrows a wrapped error when the own-PR fallback does not apply (event is COMMENT)", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 10, "a note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets"/);
    });

    it("rethrows a wrapped error for unrelated failures", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("network down"));

      await expect(
        client.submitPRReview("acme/widgets", 10, "lgtm", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets".*network down/);
    });

    it("handles a non-Error rejection value (no own-PR fallback match) by wrapping it", async () => {
      octokit.pulls.createReview.mockRejectedValue({ weird: "shape" });

      await expect(
        client.submitPRReview("acme/widgets", 10, "lgtm", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets".*\[object Object\]/);
    });
  });
});
