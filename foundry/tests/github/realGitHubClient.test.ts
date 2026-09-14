import { describe, it, expect, vi, beforeEach } from "vitest";

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

const octokitInstances: FakeOctokit[] = [];

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => {
      const instance: FakeOctokit = {
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
      octokitInstances.push(instance);
      return instance;
    }),
  };
});

const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeClient() {
  const logger = makeLogger();
  const client = new RealGitHubClient("token-123", logger as never);
  const octokit = octokitInstances[octokitInstances.length - 1]!;
  return { client, octokit, logger };
}

function apiError(status: number, message = "api error"): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  octokitInstances.length = 0;
  vi.clearAllMocks();
});

describe("RealGitHubClient: repo string parsing", () => {
  it("throws a clear error for a malformed 'owner/repo' string", async () => {
    const { client } = makeClient();
    await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
      'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves and logs on success", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.repos.get.mockResolvedValue({ data: {} });

    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
    expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets" },
      "Verified GitHub repo access",
    );
  });

  it("wraps the error with a helpful message and sets cause", async () => {
    const { client, octokit } = makeClient();
    const original = new Error("Not Found");
    octokit.repos.get.mockRejectedValue(original);

    await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
      /cannot access repo "acme\/widgets".*Original: Not Found/s,
    );
    try {
      await client.verifyRepoAccess("acme/widgets");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).cause).toBe(original);
    }
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the default_branch on success", async () => {
    const { client, octokit } = makeClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });

    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
  });

  it("throws a wrapped error on failure", async () => {
    const { client, octokit } = makeClient();
    octokit.repos.get.mockRejectedValue(new Error("boom"));

    await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
      'GitHub getDefaultBranch failed for "acme/widgets": boom',
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates the branch off the default branch's SHA", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
    octokit.git.createRef.mockResolvedValue({ data: {} });

    await client.createBranch("acme/widgets", "feature/x");

    expect(octokit.git.getRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "heads/main",
    });
    expect(octokit.git.createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "refs/heads/feature/x",
      sha: "sha123",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", branchName: "feature/x" },
      "Created branch on GitHub",
    );
  });

  it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
    octokit.git.createRef.mockRejectedValue(apiError(422));

    await expect(client.createBranch("acme/widgets", "feature/x")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/widgets", branchName: "feature/x" },
      "Branch already exists on GitHub, continuing",
    );
  });

  it("throws a wrapped error for non-422 failures", async () => {
    const { client, octokit } = makeClient();
    octokit.repos.get.mockRejectedValue(apiError(500, "server exploded"));

    await expect(client.createBranch("acme/widgets", "feature/x")).rejects.toThrow(
      /GitHub createBranch failed for "acme\/widgets".*server exploded/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates the PR and returns its number", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

    const num = await client.createDraftPR("acme/widgets", "feat", "main", "Title", "Body");

    expect(num).toBe(42);
    expect(octokit.pulls.create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      head: "feat",
      base: "main",
      title: "Title",
      body: "Body",
      draft: true,
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 42 },
      "Created draft PR on GitHub",
    );
  });

  it("on 422 field-validation error, logs and throws a wrapped error without looking up existing PRs", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.create.mockRejectedValue(
      apiError(422, 'Validation failed {"code":"invalid","field":"base"}'),
    );

    await expect(
      client.createDraftPR("acme/widgets", "feat", "bad-base", "T", "B"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/widgets", head: "feat", base: "bad-base" }),
      "PR creation failed: invalid field (base branch may not exist)",
    );
    expect(octokit.pulls.list).not.toHaveBeenCalled();
  });

  it("on 422 duplicate-PR error, looks up and returns the existing open PR", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.create.mockRejectedValue(apiError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 77 }] });

    const num = await client.createDraftPR("acme/widgets", "feat", "main", "T", "B");

    expect(num).toBe(77);
    expect(octokit.pulls.list).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      head: "acme:feat",
      base: "main",
      state: "open",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 77 },
      "Found existing open PR",
    );
  });

  it("on 422 duplicate-PR error with no existing PR found, throws the wrapped original error", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.create.mockRejectedValue(apiError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [] });

    await expect(client.createDraftPR("acme/widgets", "feat", "main", "T", "B")).rejects.toThrow(
      /GitHub createDraftPR failed/,
    );
  });

  it("throws a wrapped error for non-422 failures", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.create.mockRejectedValue(new Error("network down"));

    await expect(client.createDraftPR("acme/widgets", "feat", "main", "T", "B")).rejects.toThrow(
      /GitHub createDraftPR failed.*network down/,
    );
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("posts a comment on success", async () => {
    const { client, octokit } = makeClient();
    octokit.issues.createComment.mockResolvedValue({ data: {} });

    await client.commentOnPR("acme/widgets", 5, "hello");

    expect(octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 5,
      body: "hello",
    });
  });

  it("throws a wrapped error on failure", async () => {
    const { client, octokit } = makeClient();
    octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));

    await expect(client.commentOnPR("acme/widgets", 5, "hello")).rejects.toThrow(
      /GitHub commentOnPR failed.*rate limited/,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("returns the diff text on success", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });

    await expect(client.getPRDiff("acme/widgets", 5)).resolves.toBe("diff --git a/x b/x");
    expect(octokit.pulls.get).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 5,
      mediaType: { format: "diff" },
    });
  });

  it("throws a wrapped error on failure", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockRejectedValue(new Error("not found"));

    await expect(client.getPRDiff("acme/widgets", 5)).rejects.toThrow(
      /GitHub getPRDiff failed.*not found/,
    );
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("marks a draft PR ready via graphql", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    octokit.graphql.mockResolvedValue({});

    await client.markPRReady("acme/widgets", 5);

    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5 },
      "Marked PR as ready for review",
    );
  });

  it("does nothing when the PR is already not a draft", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });

    await client.markPRReady("acme/widgets", 5);

    expect(octokit.graphql).not.toHaveBeenCalled();
  });

  it("throws a wrapped error on failure", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockRejectedValue(new Error("boom"));

    await expect(client.markPRReady("acme/widgets", 5)).rejects.toThrow(
      /GitHub markPRReady failed.*boom/,
    );
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps comments, defaulting author to 'unknown' and body to ''", async () => {
    const { client, octokit } = makeClient();
    octokit.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
      ],
    });

    const comments = await client.listPRComments("acme/widgets", 5);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("throws a wrapped error on failure", async () => {
    const { client, octokit } = makeClient();
    octokit.issues.listComments.mockRejectedValue(new Error("boom"));

    await expect(client.listPRComments("acme/widgets", 5)).rejects.toThrow(
      /GitHub listPRComments failed.*boom/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-level comment when line is provided", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });

    const id = await client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10);

    expect(id).toBe(501);
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
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, path: "src/a.ts", line: 10, commentId: 501 },
      "Created PR review comment",
    );
  });

  it("falls back to a file-level comment when the line-specific comment 422s", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment
      .mockRejectedValueOnce(apiError(422, "line not in diff"))
      .mockResolvedValueOnce({ data: { id: 999 } });

    const id = await client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10);

    expect(id).toBe(999);
    expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 5,
      body: "*(line 10)* nit",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha1",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, path: "src/a.ts", line: 10 },
      "Line not in PR diff, falling back to file-level comment",
    );
  });

  it("re-throws and wraps a non-422 line-specific failure", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockRejectedValue(new Error("network error"));

    await expect(
      client.createPRReviewComment("acme/widgets", 5, "nit", "src/a.ts", 10),
    ).rejects.toThrow(/GitHub createPRReviewComment failed.*network error/);
  });

  it("creates a file-level comment directly when no line is given", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 42 } });

    const id = await client.createPRReviewComment("acme/widgets", 5, "general note", "src/a.ts");

    expect(id).toBe(42);
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

  it("returns 0 (does not throw) when the overall operation 422s outside the line-fallback path", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.get.mockRejectedValue(apiError(422, "PR not found"));

    const id = await client.createPRReviewComment("acme/widgets", 5, "note", "src/a.ts");

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, path: "src/a.ts", line: undefined },
      "Could not post PR review comment (file may not be in diff), skipping",
    );
  });

  it("throws a wrapped error for a non-422 failure outside the line-fallback path", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.get.mockRejectedValue(new Error("server down"));

    await expect(client.createPRReviewComment("acme/widgets", 5, "note", "src/a.ts")).rejects.toThrow(
      /GitHub createPRReviewComment failed.*server down/,
    );
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("posts a reply on success", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });

    await client.replyToReviewComment("acme/widgets", 5, 501, "thanks");

    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 5,
      comment_id: 501,
      body: "thanks",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, commentId: 501 },
      "Replied to PR review comment",
    );
  });

  it("swallows the error and logs a warning instead of throwing", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

    await expect(client.replyToReviewComment("acme/widgets", 5, 501, "thanks")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/widgets", prNumber: 5, commentId: 501, error: "comment deleted" }),
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits the review on success", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.createReview.mockResolvedValue({ data: {} });

    await client.submitPRReview("acme/widgets", 5, "LGTM", "APPROVE");

    expect(octokit.pulls.createReview).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 5,
      body: "LGTM",
      event: "APPROVE",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, event: "APPROVE" },
      "Submitted PR review",
    );
  });

  it("falls back to a COMMENT review when GitHub refuses REQUEST_CHANGES on your own PR", async () => {
    const { client, octokit, logger } = makeClient();
    octokit.pulls.createReview
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({ data: {} });

    await client.submitPRReview("acme/widgets", 5, "needs work", "REQUEST_CHANGES");

    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
    expect(octokit.pulls.createReview).toHaveBeenLastCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 5,
      body: "needs work",
      event: "COMMENT",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 5, originalEvent: "REQUEST_CHANGES" },
      "Cannot request changes on own PR, falling back to COMMENT",
    );
  });

  it("does not fall back when the event is already COMMENT, even with the same error text", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.createReview.mockRejectedValue(
      new Error("Can not request changes on your own pull request"),
    );

    await expect(client.submitPRReview("acme/widgets", 5, "note", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
  });

  it("throws a wrapped error for unrelated failures", async () => {
    const { client, octokit } = makeClient();
    octokit.pulls.createReview.mockRejectedValue(new Error("service unavailable"));

    await expect(client.submitPRReview("acme/widgets", 5, "note", "APPROVE")).rejects.toThrow(
      /GitHub submitPRReview failed.*service unavailable/,
    );
  });
});
