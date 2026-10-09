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

function makeOctokitError(status: number, message = "Request failed"): Error & { status: number } {
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

function inject(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

describe("RealGitHubClient", () => {
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeFakeOctokit();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    inject(client, octokit);
  });

  describe("splitRepo validation", () => {
    it("rejects a repo string without a slash", async () => {
      await expect(client.verifyRepoAccess("no-slash")).rejects.toThrow(
        'Invalid repo format "no-slash", expected "owner/repo"',
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps the error with guidance when access check fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*Not Found/,
      );
    });

    it("stringifies a non-Error rejection value", async () => {
      octokit.repos.get.mockRejectedValue("raw string failure");
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo".*raw string failure/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps errors", async () => {
      octokit.repos.get.mockRejectedValue(new Error("boom"));
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo"',
      );
    });

    it("wraps a non-Error rejection value via String()", async () => {
      octokit.repos.get.mockRejectedValue(404);
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        'GitHub getDefaultBranch failed for "org/repo": 404',
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch ref", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("org/repo", "feature/x");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "sha123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(makeOctokitError(422));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("wraps non-422 errors", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
      octokit.git.createRef.mockRejectedValue(makeOctokitError(500, "server exploded"));

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo".*server exploded/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 55 } });
      const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");
      expect(num).toBe(55);
      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "head",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error for a 422 field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeOctokitError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );
      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed for "org\/repo"/,
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws a wrapped error for a 422 missing_field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeOctokitError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );
      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("looks up and returns an existing open PR on a non-field 422", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeOctokitError(422, "A pull request already exists for org:head."),
      );
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR("org/repo", "head", "main", "T", "B");
      expect(num).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
    });

    it("throws when the 422 is not field validation and no existing PR is found", async () => {
      octokit.pulls.create.mockRejectedValue(
        makeOctokitError(422, "A pull request already exists for org:head."),
      );
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed/,
      );
    });

    it("throws a wrapped error for a non-422 failure", async () => {
      octokit.pulls.create.mockRejectedValue(makeOctokitError(500, "server exploded"));
      await expect(client.createDraftPR("org/repo", "head", "main", "T", "B")).rejects.toThrow(
        /GitHub createDraftPR failed.*server exploded/,
      );
    });

    it("treats a non-Error 422 rejection as not field-validation and looks up the existing PR", async () => {
      const rawRejection = { status: 422 };
      octokit.pulls.create.mockRejectedValue(rawRejection);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 88 }] });

      const num = await client.createDraftPR("org/repo", "head", "main", "T", "B");
      expect(num).toBe(88);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});
      await client.commentOnPR("org/repo", 5, "hello");
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 5,
        body: "hello",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("nope"));
      await expect(client.commentOnPR("org/repo", 5, "hello")).rejects.toThrow(
        'GitHub commentOnPR failed for "org/repo"',
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("org/repo", 5)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.getPRDiff("org/repo", 5)).rejects.toThrow(
        'GitHub getPRDiff failed for "org/repo"',
      );
    });
  });

  describe("markPRReady", () => {
    it("marks a draft PR ready via graphql", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 5);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("org/repo", 5);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.markPRReady("org/repo", 5)).rejects.toThrow(
        'GitHub markPRReady failed for "org/repo"',
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

      const comments = await client.listPRComments("org/repo", 5);
      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("nope"));
      await expect(client.listPRComments("org/repo", 5)).rejects.toThrow(
        'GitHub listPRComments failed for "org/repo"',
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-anchored comment", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 200 } });

      const id = await client.createPRReviewComment("org/repo", 5, "nit", "src/a.ts", 10);
      expect(id).toBe(200);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        body: "nit",
        path: "src/a.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(makeOctokitError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 201 } });

      const id = await client.createPRReviewComment("org/repo", 5, "nit", "src/a.ts", 10);
      expect(id).toBe(201);
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("rethrows a non-422 line-level error and wraps it", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValueOnce(makeOctokitError(500, "server exploded"));

      await expect(
        client.createPRReviewComment("org/repo", 5, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed.*server exploded/);
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 300 } });

      const id = await client.createPRReviewComment("org/repo", 5, "general note", "src/a.ts");
      expect(id).toBe(300);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        body: "general note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning on an outer 422 (e.g. file not in diff)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(makeOctokitError(422, "file not in diff"));

      const id = await client.createPRReviewComment("org/repo", 5, "note", "src/a.ts");
      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("wraps a non-422 outer error (e.g. pulls.get failure)", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("nope"));
      await expect(client.createPRReviewComment("org/repo", 5, "note", "src/a.ts")).rejects.toThrow(
        'GitHub createPRReviewComment failed for "org/repo"',
      );
    });
  });

  describe("replyToReviewComment", () => {
    it("replies on success", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await client.replyToReviewComment("org/repo", 5, 200, "thanks");
      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        comment_id: 200,
        body: "thanks",
      });
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
      await expect(client.replyToReviewComment("org/repo", 5, 200, "thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection when logging the warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("comment deleted");
      await expect(client.replyToReviewComment("org/repo", 5, 200, "thanks")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "comment deleted" }),
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokit.pulls.createReview.mockResolvedValue({});
      await client.submitPRReview("org/repo", 5, "LGTM", "APPROVE");
      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        body: "LGTM",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("org/repo", 5, "needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 5,
        body: "needs work",
        event: "COMMENT",
      });
    });

    it("does not fall back and throws when the event is already COMMENT", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );
      await expect(client.submitPRReview("org/repo", 5, "note", "COMMENT")).rejects.toThrow(
        'GitHub submitPRReview failed for "org/repo"',
      );
    });

    it("wraps unrelated errors", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("server exploded"));
      await expect(client.submitPRReview("org/repo", 5, "note", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*server exploded/,
      );
    });

    it("wraps a non-Error rejection value via String()", async () => {
      octokit.pulls.createReview.mockRejectedValue({ weird: "object" });
      await expect(client.submitPRReview("org/repo", 5, "note", "APPROVE")).rejects.toThrow(
        /GitHub submitPRReview failed.*\[object Object\]/,
      );
    });
  });
});
