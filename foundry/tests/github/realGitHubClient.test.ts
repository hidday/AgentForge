import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectOctokit(client: RealGitHubClient, octokit: Record<string, any>): void {
  (client as unknown as { octokit: unknown }).octokit = octokit;
}

function httpError(status: number, message = "GitHub API error"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient — repo name parsing", () => {
  it("throws a clear error for a malformed repo string (no slash)", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
      /Invalid repo format "not-a-valid-repo"/,
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("resolves when the repo is accessible", async () => {
    injectOctokit(client, { repos: { get: vi.fn().mockResolvedValue({ data: {} }) } });
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("wraps the underlying error with a helpful message on failure", async () => {
    injectOctokit(client, {
      repos: { get: vi.fn().mockRejectedValue(new Error("Not Found")) },
    });
    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /cannot access repo "org\/repo".*Not Found/s,
    );
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("returns the default_branch from the repo data", async () => {
    injectOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
    });
    expect(await client.getDefaultBranch("org/repo")).toBe("main");
  });

  it("wraps failures with operation context", async () => {
    injectOctokit(client, { repos: { get: vi.fn().mockRejectedValue(new Error("boom")) } });
    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "org\/repo".*boom/s,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("creates a ref from the default branch's sha", async () => {
    const createRef = vi.fn().mockResolvedValue({});
    injectOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
        createRef,
      },
    });

    await client.createBranch("org/repo", "ai/issue-1");

    expect(createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/ai/issue-1",
      sha: "abc123",
    });
  });

  it("treats a 422 (branch already exists) as success", async () => {
    injectOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
        createRef: vi.fn().mockRejectedValue(httpError(422)),
      },
    });

    await expect(client.createBranch("org/repo", "ai/issue-1")).resolves.toBeUndefined();
  });

  it("wraps a non-422 failure with branch context", async () => {
    injectOctokit(client, {
      repos: { get: vi.fn().mockRejectedValue(new Error("no access")) },
    });

    await expect(client.createBranch("org/repo", "ai/issue-1")).rejects.toThrow(
      /GitHub createBranch failed for "org\/repo".*branchName.*no access/s,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("creates a draft PR and returns its number", async () => {
    injectOctokit(client, {
      pulls: { create: vi.fn().mockResolvedValue({ data: { number: 7 } }) },
    });

    const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");
    expect(num).toBe(7);
  });

  it("throws with detail for a 422 field-validation failure (e.g. missing base branch)", async () => {
    injectOctokit(client, {
      pulls: {
        create: vi
          .fn()
          .mockRejectedValue(httpError(422, 'Validation Failed {"code":"invalid","field":"base"}')),
      },
    });

    await expect(client.createDraftPR("org/repo", "head", "main", "Title", "Body")).rejects.toThrow(
      /GitHub createDraftPR failed/,
    );
  });

  it("looks up and returns the existing open PR's number on a 422 duplicate-head error", async () => {
    injectOctokit(client, {
      pulls: {
        create: vi.fn().mockRejectedValue(httpError(422, "A pull request already exists")),
        list: vi.fn().mockResolvedValue({ data: [{ number: 55 }] }),
      },
    });

    const num = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");
    expect(num).toBe(55);
  });

  it("falls through to a wrapped error when 422 is not a validation error and no existing PR is found", async () => {
    injectOctokit(client, {
      pulls: {
        create: vi.fn().mockRejectedValue(httpError(422, "A pull request already exists")),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    });

    await expect(client.createDraftPR("org/repo", "head", "main", "Title", "Body")).rejects.toThrow(
      /GitHub createDraftPR failed/,
    );
  });

  it("wraps a non-422 failure", async () => {
    injectOctokit(client, {
      pulls: { create: vi.fn().mockRejectedValue(new Error("network error")) },
    });

    await expect(client.createDraftPR("org/repo", "head", "main", "Title", "Body")).rejects.toThrow(
      /GitHub createDraftPR failed.*network error/s,
    );
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("posts an issue comment", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    injectOctokit(client, { issues: { createComment } });

    await client.commentOnPR("org/repo", 5, "hello");

    expect(createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 5,
      body: "hello",
    });
  });

  it("wraps failures with prNumber context", async () => {
    injectOctokit(client, { issues: { createComment: vi.fn().mockRejectedValue(new Error("rate limited")) } });
    await expect(client.commentOnPR("org/repo", 5, "hello")).rejects.toThrow(
      /GitHub commentOnPR failed.*prNumber.*rate limited/s,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("returns the diff text", async () => {
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: "diff --git a/x b/x" }) },
    });
    expect(await client.getPRDiff("org/repo", 1)).toBe("diff --git a/x b/x");
  });

  it("wraps failures", async () => {
    injectOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("not found")) } });
    await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
  });
});

describe("RealGitHubClient.markPRReady", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("returns early without calling the mutation when the PR is already non-draft", async () => {
    const graphql = vi.fn();
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { draft: false, node_id: "n1" } }) },
      graphql,
    });

    await client.markPRReady("org/repo", 1);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("marks a draft PR ready via the GraphQL mutation", async () => {
    const graphql = vi.fn().mockResolvedValue({});
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { draft: true, node_id: "n1" } }) },
      graphql,
    });

    await client.markPRReady("org/repo", 1);
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "n1",
    });
  });

  it("wraps failures", async () => {
    injectOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("gone")) } });
    await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(/GitHub markPRReady failed/);
  });
});

describe("RealGitHubClient.listPRComments", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("maps comments, defaulting missing author/body", async () => {
    injectOctokit(client, {
      issues: {
        listComments: vi.fn().mockResolvedValue({
          data: [
            { id: 1, user: { login: "alice" }, body: "hi", created_at: "2024-01-01T00:00:00Z" },
            { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
          ],
        }),
      },
    });

    const comments = await client.listPRComments("org/repo", 1);
    expect(comments).toEqual([
      { id: "1", author: "alice", body: "hi", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
    ]);
  });

  it("wraps failures", async () => {
    injectOctokit(client, { issues: { listComments: vi.fn().mockRejectedValue(new Error("boom")) } });
    await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(/GitHub listPRComments failed/);
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("creates a line-anchored comment when line is provided", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 99 } });
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);

    expect(id).toBe(99);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 10, side: "RIGHT", commit_id: "sha1" }),
    );
  });

  it("creates a file-level comment when no line is provided", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 100 } });
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "general note", "src/a.ts");

    expect(id).toBe(100);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "file", body: "general note" }),
    );
    expect(createReviewComment.mock.calls[0]![0]).not.toHaveProperty("line");
  });

  it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
    const createReviewComment = vi
      .fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ data: { id: 101 } });
    const logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    injectOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 42);

    expect(id).toBe(101);
    expect(createReviewComment).toHaveBeenCalledTimes(2);
    const fallbackCall = createReviewComment.mock.calls[1]![0] as { body: string; subject_type: string };
    expect(fallbackCall.body).toContain("(line 42)");
    expect(fallbackCall.subject_type).toBe("file");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 42 }),
      "Line not in PR diff, falling back to file-level comment",
    );
  });

  it("rethrows a non-422 error from the line-anchored attempt", async () => {
    injectOctokit(client, {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment: vi.fn().mockRejectedValue(new Error("network down")),
      },
    });

    await expect(
      client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 42),
    ).rejects.toThrow(/GitHub createPRReviewComment failed.*network down/s);
  });

  it("returns 0 and logs a warning when the file is not in the diff at all (422 on pulls.get context)", async () => {
    const logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    injectOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(httpError(422)) } });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 42);

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 42 }),
      "Could not post PR review comment (file may not be in diff), skipping",
    );
  });

  it("wraps a non-422 outer failure", async () => {
    injectOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("boom")) } });
    await expect(client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts")).rejects.toThrow(
      /GitHub createPRReviewComment failed/,
    );
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("posts a reply via the SDK", async () => {
    const createReplyForReviewComment = vi.fn().mockResolvedValue({});
    injectOctokit(client, { pulls: { createReplyForReviewComment } });

    await client.replyToReviewComment("org/repo", 1, 555, "thanks");

    expect(createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 555, body: "thanks" }),
    );
  });

  it("swallows the error and logs a warning instead of throwing", async () => {
    const logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    injectOctokit(client, {
      pulls: { createReplyForReviewComment: vi.fn().mockRejectedValue(new Error("comment deleted")) },
    });

    await expect(client.replyToReviewComment("org/repo", 1, 555, "thanks")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 555, error: "comment deleted" }),
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  let client: RealGitHubClient;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
  });

  it("submits a review with the given event", async () => {
    const createReview = vi.fn().mockResolvedValue({});
    injectOctokit(client, { pulls: { createReview } });

    await client.submitPRReview("org/repo", 1, "LGTM", "APPROVE");

    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({ body: "LGTM", event: "APPROVE" }),
    );
  });

  it("falls back to COMMENT when REQUEST_CHANGES is rejected for being the PR author", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({});
    const logger = makeLogger();
    client = new RealGitHubClient("token", logger as never);
    injectOctokit(client, { pulls: { createReview } });

    await client.submitPRReview("org/repo", 1, "Needs fixes", "REQUEST_CHANGES");

    expect(createReview).toHaveBeenCalledTimes(2);
    expect(createReview.mock.calls[1]![0]).toMatchObject({ event: "COMMENT" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ originalEvent: "REQUEST_CHANGES" }),
      "Cannot request changes on own PR, falling back to COMMENT",
    );
  });

  it("wraps the error (no fallback) when the event is already COMMENT", async () => {
    injectOctokit(client, {
      pulls: {
        createReview: vi.fn().mockRejectedValue(new Error("Can not request changes on your own pull request")),
      },
    });

    await expect(client.submitPRReview("org/repo", 1, "note", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });

  it("wraps the error (no fallback) when the message does not match the own-PR pattern", async () => {
    injectOctokit(client, { pulls: { createReview: vi.fn().mockRejectedValue(new Error("server error")) } });

    await expect(client.submitPRReview("org/repo", 1, "note", "REQUEST_CHANGES")).rejects.toThrow(
      /GitHub submitPRReview failed.*server error/s,
    );
  });
});
