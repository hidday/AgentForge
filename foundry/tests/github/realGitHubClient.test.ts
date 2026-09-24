import { describe, it, expect, vi, beforeEach } from "vitest";
import { Octokit } from "@octokit/rest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";
import type { Logger } from "../../src/utils/logger.js";

const octokitMock = {
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

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => octokitMock),
  };
});

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeClient() {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger);
  return { client, logger };
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// A rejection value that is NOT an `Error` instance, used to exercise the
// `err instanceof Error ? err.message : String(err)` fallback branches.
function nonErrorRejection(status?: number, stringValue = "non-error failure") {
  return {
    status,
    toString: () => stringValue,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RealGitHubClient", () => {
  it("constructs an Octokit instance with the provided token", () => {
    makeClient();
    expect(Octokit).toHaveBeenCalledWith({ auth: "test-token" });
  });

  describe("verifyRepoAccess", () => {
    it("resolves and logs debug on success", async () => {
      const { client, logger } = makeClient();
      octokitMock.repos.get.mockResolvedValue({ data: {} });

      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();

      expect(octokitMock.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a descriptive wrapped error when the API call fails", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockRejectedValue(new Error("Not Found"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Not Found/s,
      );
    });

    it("throws on a malformed repo string with no slash", async () => {
      const { client } = makeClient();

      await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
        /Invalid repo format "not-a-valid-repo", expected "owner\/repo"/,
      );
      expect(octokitMock.repos.get).not.toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection value in the wrapped message", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockRejectedValue(nonErrorRejection(undefined, "weird failure"));

      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*weird failure/s,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the repo's default_branch", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("throws a wrapped error on failure", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockRejectedValue(new Error("rate limited"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*rate limited/s,
      );
    });

    it("throws on a malformed repo string", async () => {
      const { client } = makeClient();
      await expect(client.getDefaultBranch("bad")).rejects.toThrow(/Invalid repo format/);
    });

    it("stringifies a non-Error rejection value in the wrapped message (wrapError fallback)", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockRejectedValue(nonErrorRejection(undefined, "weird failure"));

      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "acme\/widgets".*weird failure/s,
      );
    });
  });

  describe("createBranch", () => {
    it("fetches the default branch ref and creates the new branch", async () => {
      const { client, logger } = makeClient();
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokitMock.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "ai/issue-1");

      expect(octokitMock.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokitMock.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/ai/issue-1",
        sha: "abc123",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
      const { client, logger } = makeClient();
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokitMock.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error for non-422 failures", async () => {
      const { client } = makeClient();
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        /GitHub createBranch failed for "acme\/widgets".*server error/s,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates and returns the new PR number", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.create.mockResolvedValue({ data: { number: 55 } });

      const num = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(num).toBe(55);
      expect(octokitMock.pulls.create).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "ai/issue-1",
        base: "main",
        title: "Title",
        body: "Body",
        draft: true,
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error on a 422 field-validation failure (invalid base branch)", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.create.mockRejectedValue(
        httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "no-such-branch", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokitMock.pulls.list).not.toHaveBeenCalled();
    });

    it("looks up and returns an existing open PR on a non-field-validation 422", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

      const num = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Title",
        "Body",
      );

      expect(num).toBe(77);
      expect(octokitMock.pulls.list).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        head: "acme:ai/issue-1",
        base: "main",
        state: "open",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("throws a wrapped error when the 422 lookup finds no existing PR", async () => {
      const { client } = makeClient();
      octokitMock.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
    });

    it("throws a wrapped error for non-422 failures", async () => {
      const { client } = makeClient();
      octokitMock.pulls.create.mockRejectedValue(httpError(500, "server error"));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets".*server error/s);
    });

    it("treats a 422 with a non-Error rejection whose stringified message signals field validation", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.create.mockRejectedValue(
        nonErrorRejection(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "no-such-branch", "Title", "Body"),
      ).rejects.toThrow(/GitHub createDraftPR failed for "acme\/widgets"/);
      expect(logger.error).toHaveBeenCalled();
      expect(octokitMock.pulls.list).not.toHaveBeenCalled();
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment and logs debug", async () => {
      const { client, logger } = makeClient();
      octokitMock.issues.createComment.mockResolvedValue({});

      await client.commentOnPR("acme/widgets", 42, "Nice work");

      expect(octokitMock.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 42,
        body: "Nice work",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error on failure", async () => {
      const { client } = makeClient();
      octokitMock.issues.createComment.mockRejectedValue(new Error("forbidden"));

      await expect(client.commentOnPR("acme/widgets", 42, "Nice work")).rejects.toThrow(
        /GitHub commentOnPR failed for "acme\/widgets".*forbidden/s,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff data as a string", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

      await expect(client.getPRDiff("acme/widgets", 42)).resolves.toBe("diff --git a/x b/x");
      expect(octokitMock.pulls.get).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        mediaType: { format: "diff" },
      });
    });

    it("throws a wrapped error on failure", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockRejectedValue(new Error("not found"));

      await expect(client.getPRDiff("acme/widgets", 42)).rejects.toThrow(
        /GitHub getPRDiff failed for "acme\/widgets".*not found/s,
      );
    });
  });

  describe("markPRReady", () => {
    it("returns early without calling graphql when the PR is already ready", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

      await client.markPRReady("acme/widgets", 42);

      expect(octokitMock.graphql).not.toHaveBeenCalled();
    });

    it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokitMock.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 42);

      expect(octokitMock.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
        prId: "node-1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("throws a wrapped error when fetching the PR fails", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockRejectedValue(new Error("gone"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed for "acme\/widgets".*gone/s,
      );
    });

    it("throws a wrapped error when the graphql mutation fails", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokitMock.graphql.mockRejectedValue(new Error("mutation failed"));

      await expect(client.markPRReady("acme/widgets", 42)).rejects.toThrow(
        /GitHub markPRReady failed for "acme\/widgets".*mutation failed/s,
      );
    });
  });

  describe("listPRComments", () => {
    it("maps returned comments, defaulting missing author/body", async () => {
      const { client } = makeClient();
      octokitMock.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: "alice" },
            body: "First comment",
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

      const comments = await client.listPRComments("acme/widgets", 42);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "First comment", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("returns an empty array when there are no comments", async () => {
      const { client } = makeClient();
      octokitMock.issues.listComments.mockResolvedValue({ data: [] });

      await expect(client.listPRComments("acme/widgets", 42)).resolves.toEqual([]);
    });

    it("throws a wrapped error on failure", async () => {
      const { client } = makeClient();
      octokitMock.issues.listComments.mockRejectedValue(new Error("boom"));

      await expect(client.listPRComments("acme/widgets", 42)).rejects.toThrow(
        /GitHub listPRComments failed for "acme\/widgets".*boom/s,
      );
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level comment when a line is given", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "Nit here",
        "src/x.ts",
        10,
      );

      expect(id).toBe(501);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "Nit here",
        path: "src/x.ts",
        line: 10,
        side: "RIGHT",
        commit_id: "sha1",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("creates a file-level comment when no line is given", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 502 } });

      const id = await client.createPRReviewComment("acme/widgets", 42, "General note", "src/x.ts");

      expect(id).toBe(502);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "General note",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422, "line not in diff"))
        .mockResolvedValueOnce({ data: { id: 503 } });

      const id = await client.createPRReviewComment(
        "acme/widgets",
        42,
        "Nit here",
        "src/x.ts",
        10,
      );

      expect(id).toBe(503);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "*(line 10)* Nit here",
        path: "src/x.ts",
        subject_type: "file",
        commit_id: "sha1",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("propagates a non-422 error from the line-level attempt as a wrapped error", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockRejectedValue(new Error("server exploded"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "Nit here", "src/x.ts", 10),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*server exploded/s);
    });

    it("returns 0 and logs a warning when the file itself is not in the diff (422 on pulls.get)", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.get.mockRejectedValue(httpError(422, "file not in diff"));

      const id = await client.createPRReviewComment("acme/widgets", 42, "Note", "src/missing.ts");

      expect(id).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("throws a wrapped error for a non-422 failure while fetching the PR", async () => {
      const { client } = makeClient();
      octokitMock.pulls.get.mockRejectedValue(new Error("network down"));

      await expect(
        client.createPRReviewComment("acme/widgets", 42, "Note", "src/x.ts"),
      ).rejects.toThrow(/GitHub createPRReviewComment failed for "acme\/widgets".*network down/s);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply and logs debug on success", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.createReplyForReviewComment.mockResolvedValue({});

      await client.replyToReviewComment("acme/widgets", 42, 501, "Thanks!");

      expect(octokitMock.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        comment_id: 501,
        body: "Thanks!",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("swallows failures and logs a warning instead of throwing", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment gone"));

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "Thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection value in the warn log (does not throw)", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(
        nonErrorRejection(undefined, "weird failure"),
      );

      await expect(
        client.replyToReviewComment("acme/widgets", 42, 501, "Thanks!"),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "weird failure" }),
        expect.any(String),
      );
    });
  });

  describe("submitPRReview", () => {
    it("submits a review and logs debug on success", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 42, "LGTM", "APPROVE");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "LGTM",
        event: "APPROVE",
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("falls back to COMMENT when REQUEST_CHANGES is rejected for reviewing one's own PR", async () => {
      const { client, logger } = makeClient();
      octokitMock.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 42, "Needs fixes", "REQUEST_CHANGES");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokitMock.pulls.createReview).toHaveBeenLastCalledWith({
        owner: "acme",
        repo: "widgets",
        pull_number: 42,
        body: "Needs fixes",
        event: "COMMENT",
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not retry when the event is already COMMENT, even with the own-PR message", async () => {
      const { client } = makeClient();
      octokitMock.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 42, "Note", "COMMENT"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets"/);
      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("throws a wrapped error for unrelated failures", async () => {
      const { client } = makeClient();
      octokitMock.pulls.createReview.mockRejectedValue(new Error("server error"));

      await expect(
        client.submitPRReview("acme/widgets", 42, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets".*server error/s);
    });

    it("stringifies a non-Error rejection value in the wrapped message", async () => {
      const { client } = makeClient();
      octokitMock.pulls.createReview.mockRejectedValue(
        nonErrorRejection(undefined, "weird failure"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 42, "LGTM", "APPROVE"),
      ).rejects.toThrow(/GitHub submitPRReview failed for "acme\/widgets".*weird failure/s);
    });
  });

  describe("splitRepo (via any method)", () => {
    it("throws when the repo string has no slash", async () => {
      const { client } = makeClient();

      await expect(client.commentOnPR("no-slash-here", 1, "x")).rejects.toThrow(
        /Invalid repo format "no-slash-here", expected "owner\/repo"/,
      );
    });

    it("throws when the repo string is missing the repo name after the slash", async () => {
      const { client } = makeClient();

      await expect(client.commentOnPR("owner-only/", 1, "x")).rejects.toThrow(
        /Invalid repo format "owner-only\/", expected "owner\/repo"/,
      );
    });
  });
});
