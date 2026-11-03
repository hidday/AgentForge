import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";
import type { Logger } from "../../src/utils/logger.js";

const { OctokitMock } = vi.hoisted(() => ({ OctokitMock: vi.fn() }));

vi.mock("@octokit/rest", () => ({
  Octokit: OctokitMock,
}));

function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as unknown as { status: number }).status = status;
  return err;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => makeLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeOctokit() {
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

type MockOctokit = ReturnType<typeof makeOctokit>;

describe("RealGitHubClient", () => {
  let octokit: MockOctokit;
  let logger: Logger;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeOctokit();
    OctokitMock.mockImplementation(() => octokit);
    logger = makeLogger();
    client = new RealGitHubClient("token-123", logger);
  });

  it("constructs an Octokit instance with the given auth token", () => {
    expect(OctokitMock).toHaveBeenCalledWith({ auth: "token-123" });
  });

  describe("repo format validation (splitRepo)", () => {
    it("rejects a repo string without a slash before making any API call", async () => {
      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format "not-a-valid-repo", expected "owner\/repo"/,
      );
      expect(octokit.repos.get).not.toHaveBeenCalled();
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();

      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("wraps an Error failure with a descriptive message and sets cause", async () => {
      const original = new Error("404 Not Found");
      octokit.repos.get.mockRejectedValue(original);

      await expect(client.verifyRepoAccess("org/repo")).rejects.toMatchObject({
        message: expect.stringContaining(
          'GitHub: cannot access repo "org/repo". Check that GITHUB_TOKEN has repository access permissions. Original: 404 Not Found',
        ),
        cause: original,
      });
    });

    it("stringifies a non-Error throw", async () => {
      octokit.repos.get.mockRejectedValue("boom");

      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(/Original: boom/);
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch on success", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
    });

    it("wraps failure via wrapError", async () => {
      octokit.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo".*rate limited/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a ref from the default branch's sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
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
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("re-throws (wrapped) for a non-422 error", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /GitHub createBranch failed for "org\/repo"/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("returns the new PR number on success", async () => {
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

    it("throws wrapped when a 422 is a field validation error (invalid base)", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"message":"Validation Failed","errors":[{"code":"invalid"}]}'),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "nonexistent-base", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws wrapped when a 422 is a missing_field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"errors":[{"code":"missing_field"}]}'),
      );

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("on a non-field-validation 422, looks up and returns the existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

      expect(num).toBe(77);
      expect(octokit.pulls.list).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        head: "org:head",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws wrapped if the 422 lookup finds no existing open PR", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("throws wrapped for a non-422 error", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(500, "server error"));

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });

    it("stringifies a non-Error 422 throw when checking for field validation", async () => {
      const nonError = { status: 422 } as unknown as Error;
      octokit.pulls.create.mockRejectedValue(nonError);
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment on success", async () => {
      octokit.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("org/repo", 10, "hello");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        issue_number: 10,
        body: "hello",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws wrapped on failure", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("boom"));

      await expect(client.commentOnPR("org/repo", 10, "hello")).rejects.toThrow(
        /GitHub commentOnPR failed for "org\/repo"/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text on success", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });

      await expect(client.getPRDiff("org/repo", 5)).resolves.toBe("diff --git a b");
      expect(octokit.pulls.get).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 5,
        mediaType: { format: "diff" },
      });
    });

    it("throws wrapped on failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("org/repo", 5)).rejects.toThrow(
        /GitHub getPRDiff failed for "org\/repo"/,
      );
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("org/repo", 9);

      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 9);

      expect(octokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "node-1" },
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws wrapped when fetching the PR fails", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(client.markPRReady("org/repo", 9)).rejects.toThrow(
        /GitHub markPRReady failed for "org\/repo"/,
      );
    });

    it("throws wrapped when the mutation fails", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockRejectedValue(new Error("mutation failed"));

      await expect(client.markPRReady("org/repo", 9)).rejects.toThrow(
        /GitHub markPRReady failed for "org\/repo"/,
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

      const comments = await client.listPRComments("org/repo", 3);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
      ]);
    });

    it("returns an empty array when there are no comments", async () => {
      octokit.issues.listComments.mockResolvedValue({ data: [] });

      await expect(client.listPRComments("org/repo", 3)).resolves.toEqual([]);
    });

    it("throws wrapped on failure", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("org/repo", 3)).rejects.toThrow(
        /GitHub listPRComments failed for "org\/repo"/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 12);

      expect(id).toBe(500);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "body",
        path: "src/a.ts",
        line: 12,
        side: "RIGHT",
        commit_id: "sha1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("creates a file-level comment when no line is given", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts");

      expect(id).toBe(501);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 502 } });

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 99);

      expect(id).toBe(502);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReviewComment).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "*(line 99)* body",
        path: "src/a.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("re-throws a non-422 error from the line-level attempt, which the outer catch wraps", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokit.pulls.createReviewComment.mockRejectedValueOnce(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });

    it("returns 0 and logs a warning on an outer 422 (e.g. file not in diff at all)", async () => {
      octokit.pulls.get.mockRejectedValue(httpError(422, "file not found in diff"));

      const id = await client.createPRReviewComment("org/repo", 1, "body", "src/missing.ts", 1);

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("throws wrapped for a non-422 outer failure", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("org/repo", 1, "body", "src/a.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("replies on success and logs debug", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("org/repo", 1, 500, "thanks");

      expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        comment_id: 500,
        body: "thanks",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows failures, logging a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("org/repo", 1, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error failure in the logged warning", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("weird failure");

      await expect(
        client.replyToReviewComment("org/repo", 1, 500, "thanks"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "weird failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review on success", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("org/repo", 1, "lgtm", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "lgtm",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to COMMENT when GitHub rejects REQUEST_CHANGES on one's own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await expect(
        client.submitPRReview("org/repo", 1, "changes please", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
        owner: "org",
        repo: "repo",
        pull_number: 1,
        body: "changes please",
        event: "COMMENT",
      });
    });

    it("does not fall back when the event is already COMMENT, even with a matching message", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("org/repo", 1, "note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws wrapped for an unrelated failure message", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("org/repo", 1, "note", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed/);
    });

    it("throws wrapped for a non-Error throw", async () => {
      octokit.pulls.createReview.mockRejectedValue("weird failure");

      await expect(
        client.submitPRReview("org/repo", 1, "note", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed.*weird failure/);
    });
  });
});
