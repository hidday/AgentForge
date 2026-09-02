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
  // Inject the fake Octokit instance in place of the real one, mirroring the
  // dependency-injection style used by RealLinearClient's tests.
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return { client, octokit, logger };
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, octokit, logger } = makeClient());
  });

  describe("repo format validation", () => {
    it("rejects a repo string with no slash before making any API call", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format "not-a-valid-repo", expected "owner\/repo"/,
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets" },
        "Verified GitHub repo access",
      );
    });

    it("wraps the underlying error with a permission hint", async () => {
      octokit.repos.get.mockRejectedValue(new Error("404 Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Original: 404 Not Found/s,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(/Original: boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors with operation context", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*rate limited/,
      );
    });

    it("stringifies a non-Error rejection when wrapping (wrapError's non-Error branch)", async () => {
      octokit.repos.get.mockRejectedValue({ weird: "object" });

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(/\[object Object\]/);
    });
  });

  describe("createBranch", () => {
    it("creates a branch from the default branch head", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Created branch on GitHub",
      );
    });

    it("treats a 422 from createRef as 'branch already exists' and does not throw", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", branchName: "feature/x" },
        "Branch already exists on GitHub, continuing",
      );
    });

    it("wraps non-422 errors with branchName context", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(new Error("ref lookup failed"));

      await expect(client.createBranch("acme/widgets", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets" \{"branchName":"feature\/x"\}.*ref lookup failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "Title", "Body"),
      ).resolves.toBe(42);

      expect(octokit.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "feature/x",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
    });

    it("throws a wrapped error on a 422 field-validation failure (bad base branch)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "no-such-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokit.pulls.list).not.toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 missing_field validation failure", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"missing_field","field":"title"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("looks up and returns an already-existing open PR on a non-field-validation 422", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "Title", "Body"),
      ).resolves.toBe(7);

      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:feature/x",
        base: "main",
        state: "open",
      });
    });

    it("throws when the 'already exists' 422 has no matching open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("wraps non-422 errors directly", async () => {
      octokit.pulls.create.mockRejectedValue(new Error("network down"));

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed.*network down/);
    });

    it("stringifies a non-Error 422 rejection when checking for field-validation codes", async () => {
      const nonError = { status: 422, toString: () => "weird 422 payload" };
      octokit.pulls.create.mockRejectedValue(nonError);
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "feature/x", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await expect(client.commentOnPR("acme/widgets", 5, "hello")).resolves.toBeUndefined();

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 5,
        body: "hello",
      });
    });

    it("wraps errors with the PR number", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("nope"));

      await expect(client.commentOnPR("acme/widgets", 5, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets" \{"prNumber":5\}/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("acme/widgets", 5)).resolves.toBe("diff --git a b");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 5)).rejects.toThrow(/GitHub getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already ready (not a draft)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "PR_1" } });

      await expect(client.markPRReady("acme/widgets", 5)).resolves.toBeUndefined();
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_1" } });
      octokit.graphql.mockResolvedValue({});

      await expect(client.markPRReady("acme/widgets", 5)).resolves.toBeUndefined();

      expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "PR_1",
      });
    });

    it("wraps errors from the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_1" } });
      octokit.graphql.mockRejectedValue(new Error("graphql exploded"));

      await expect(client.markPRReady("acme/widgets", 5)).rejects.toThrow(/GitHub markPRReady failed/);
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

      const comments = await client.listPRComments("acme/widgets", 5);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 5)).rejects.toThrow(
        /GitHub listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is provided", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 900 } });

      const id = await client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10);

      expect(id).toBe(900);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
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
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 901 } });

      const id = await client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10);

      expect(id).toBe(901);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, path: "src/a.ts", line: 10 },
        "Line not in PR diff, falling back to file-level comment",
      );
      expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "*(line 10)* nit",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("propagates a non-422 line-level failure as a wrapped error", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("creates a file-level comment directly when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 902 } });

      const id = await client.createPRReviewComment("acme/widgets", 5, "general note", "src/a.ts");

      expect(id).toBe(902);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "general note",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("returns 0 and logs a warning when the outer PR lookup itself 422s", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422, "file not in diff at all"));

      const id = await client.createPRReviewComment("acme/widgets", 5, "nit", "src/missing.ts", 3);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, path: "src/missing.ts", line: 3 },
        "Could not post PR review comment (file may not be in diff), skipping",
      );
    });

    it("wraps a non-422 failure from the outer PR lookup", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("PR lookup failed"));

      await expect(
        client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 3),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies successfully", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await expect(
        client.replyToReviewComment("acme/widgets", 5, 900, "thanks"),
      ).resolves.toBeUndefined();

      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 900 },
        "Replied to PR review comment",
      );
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 5, 900, "thanks"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 900, error: "comment gone" },
        "Failed to reply to PR review comment, skipping",
      );
    });

    it("stringifies a non-Error rejection in the warning log", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("plain string failure");

      await expect(
        client.replyToReviewComment("acme/widgets", 5, 900, "thanks"),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, commentId: 900, error: "plain string failure" },
        "Failed to reply to PR review comment, skipping",
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await expect(
        client.submitPRReview("acme/widgets", 5, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "lgtm",
        event: "APPROVE",
      });
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("acme/widgets", 5, "please fix", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "acme",
        repo: "widgets",
        pull_number: 5,
        body: "please fix",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, originalEvent: "REQUEST_CHANGES" },
        "Cannot request changes on own PR, falling back to COMMENT",
      );
    });

    it("also falls back to COMMENT for an APPROVE that hits the 'own PR' error", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("cannot request changes on your own PR"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("acme/widgets", 5, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
    });

    it("does not fall back when the event is already COMMENT, and throws a wrapped error", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 5, "note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error when the failure message does not match the 'own PR' pattern", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

      await expect(
        client.submitPRReview("acme/widgets", 5, "note", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*service unavailable/);
    });

    it("stringifies a non-Error rejection when checking for the 'own PR' pattern", async () => {
      octokit.pulls.createReview.mockRejectedValue({ toString: () => "not an Error instance" });

      await expect(
        client.submitPRReview("acme/widgets", 5, "note", "REQUEST_CHANGES"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });
  });
});
