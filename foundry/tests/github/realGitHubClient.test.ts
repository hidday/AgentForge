import { describe, it, expect, vi } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function withStatus(err: unknown, status: number): unknown {
  return Object.assign(err instanceof Error ? err : new Error(String(err)), { status });
}

function installFakeOctokit(client: RealGitHubClient, octokit: Record<string, unknown>) {
  (client as unknown as { octokit: Record<string, unknown> }).octokit = octokit;
}

describe("RealGitHubClient repo format validation", () => {
  it("throws a descriptive error for a repo string without a slash", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);

    await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
      'Invalid repo format "not-a-valid-repo", expected "owner/repo"',
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves when the repo is reachable", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: {} });
    installFakeOctokit(client, { repos: { get } });

    await client.verifyRepoAccess("org/repo");

    expect(get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    expect(logger.debug).toHaveBeenCalledWith({ repo: "org/repo" }, "Verified GitHub repo access");
  });

  it("wraps and rethrows with guidance when the repo cannot be accessed", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockRejectedValue(new Error("Not Found"));
    installFakeOctokit(client, { repos: { get } });

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /cannot access repo "org\/repo".*Original: Not Found/,
    );
  });

  it("stringifies a non-Error rejection in the wrapped message", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockRejectedValue("plain string failure");
    installFakeOctokit(client, { repos: { get } });

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(/plain string failure/);
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the repo's default branch", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "develop" } });
    installFakeOctokit(client, { repos: { get } });

    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
  });

  it("throws a wrapped error when the request fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockRejectedValue(new Error("boom"));
    installFakeOctokit(client, { repos: { get } });

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "org\/repo": boom/,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates a branch off the default branch's head sha", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } });
    const createRef = vi.fn().mockResolvedValue({ data: {} });
    installFakeOctokit(client, { repos: { get }, git: { getRef, createRef } });

    await client.createBranch("org/repo", "ai/feature");

    expect(getRef).toHaveBeenCalledWith({ owner: "org", repo: "repo", ref: "heads/main" });
    expect(createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/ai/feature",
      sha: "sha123",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", branchName: "ai/feature" },
      "Created branch on GitHub",
    );
  });

  it("treats a 422 (branch already exists) as success and logs instead of throwing", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } });
    const createRef = vi.fn().mockRejectedValue(withStatus(new Error("Reference already exists"), 422));
    installFakeOctokit(client, { repos: { get }, git: { getRef, createRef } });

    await expect(client.createBranch("org/repo", "ai/feature")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", branchName: "ai/feature" },
      "Branch already exists on GitHub, continuing",
    );
  });

  it("throws a wrapped error for a non-422 failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockRejectedValue(new Error("network error"));
    const createRef = vi.fn();
    installFakeOctokit(client, { repos: { get }, git: { getRef, createRef } });

    await expect(client.createBranch("org/repo", "ai/feature")).rejects.toThrow(
      /GitHub createBranch failed for "org\/repo"/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates a draft PR and returns its number", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const create = vi.fn().mockResolvedValue({ data: { number: 42 } });
    installFakeOctokit(client, { pulls: { create } });

    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(42);
    expect(create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      head: "head",
      base: "main",
      title: "Title",
      body: "Body",
      draft: true,
    });
  });

  it("throws a wrapped error for a 422 invalid-field validation failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const create = vi
      .fn()
      .mockRejectedValue(withStatus(new Error('{"code":"invalid","field":"base"}'), 422));
    installFakeOctokit(client, { pulls: { create } });

    await expect(
      client.createDraftPR("org/repo", "head", "missing-base", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
  });

  it("looks up and returns an existing open PR on a 422 'already exists' failure", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const create = vi.fn().mockRejectedValue(withStatus(new Error("A pull request already exists"), 422));
    const list = vi.fn().mockResolvedValue({ data: [{ number: 55 }] });
    installFakeOctokit(client, { pulls: { create, list } });

    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(55);
    expect(list).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      head: "org:head",
      base: "main",
      state: "open",
    });
    expect(logger.info).toHaveBeenCalledWith({ repo: "org/repo", prNumber: 55 }, "Found existing open PR");
  });

  it("throws a wrapped error on a 422 'already exists' failure when no open PR is found", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const create = vi.fn().mockRejectedValue(withStatus(new Error("A pull request already exists"), 422));
    const list = vi.fn().mockResolvedValue({ data: [] });
    installFakeOctokit(client, { pulls: { create, list } });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
  });

  it("throws a wrapped error for a non-422 failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const create = vi.fn().mockRejectedValue(new Error("server error"));
    installFakeOctokit(client, { pulls: { create } });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo".*server error/);
  });

  it("wraps a 422 failure whose message is not an Error instance", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const create = vi.fn().mockRejectedValue({ status: 422 });
    installFakeOctokit(client, { pulls: { create, list: vi.fn().mockResolvedValue({ data: [] }) } });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed for "org\/repo"/);
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("posts a comment on the PR's issue thread", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createComment = vi.fn().mockResolvedValue({ data: {} });
    installFakeOctokit(client, { issues: { createComment } });

    await client.commentOnPR("org/repo", 42, "Nice work");

    expect(createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 42,
      body: "Nice work",
    });
  });

  it("throws a wrapped error when commenting fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const createComment = vi.fn().mockRejectedValue(new Error("rate limited"));
    installFakeOctokit(client, { issues: { createComment } });

    await expect(client.commentOnPR("org/repo", 42, "Nice work")).rejects.toThrow(
      /GitHub commentOnPR failed for "org\/repo".*rate limited/,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("returns the raw diff text", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: "diff --git a/x b/x" });
    installFakeOctokit(client, { pulls: { get } });

    await expect(client.getPRDiff("org/repo", 42)).resolves.toBe("diff --git a/x b/x");
    expect(get).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      mediaType: { format: "diff" },
    });
  });

  it("throws a wrapped error when fetching the diff fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockRejectedValue(new Error("not found"));
    installFakeOctokit(client, { pulls: { get } });

    await expect(client.getPRDiff("org/repo", 42)).rejects.toThrow(
      /GitHub getPRDiff failed for "org\/repo".*not found/,
    );
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("does nothing when the PR is already not a draft", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { draft: false } });
    const graphql = vi.fn();
    installFakeOctokit(client, { pulls: { get }, graphql });

    await client.markPRReady("org/repo", 42);

    expect(graphql).not.toHaveBeenCalled();
  });

  it("marks a draft PR ready via the GraphQL mutation", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    const graphql = vi.fn().mockResolvedValue({});
    installFakeOctokit(client, { pulls: { get }, graphql });

    await client.markPRReady("org/repo", 42);

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42 },
      "Marked PR as ready for review",
    );
  });

  it("throws a wrapped error when the GraphQL mutation fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    const graphql = vi.fn().mockRejectedValue(new Error("graphql failure"));
    installFakeOctokit(client, { pulls: { get }, graphql });

    await expect(client.markPRReady("org/repo", 42)).rejects.toThrow(
      /GitHub markPRReady failed for "org\/repo".*graphql failure/,
    );
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps comments, defaulting author to 'unknown' and body to '' when absent", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const listComments = vi.fn().mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "Looks good", created_at: "2024-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
      ],
    });
    installFakeOctokit(client, { issues: { listComments } });

    const comments = await client.listPRComments("org/repo", 42);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "Looks good", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
    ]);
  });

  it("throws a wrapped error when listing comments fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const listComments = vi.fn().mockRejectedValue(new Error("forbidden"));
    installFakeOctokit(client, { issues: { listComments } });

    await expect(client.listPRComments("org/repo", 42)).rejects.toThrow(
      /GitHub listPRComments failed for "org\/repo".*forbidden/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-anchored review comment when line is provided", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 777 } });
    installFakeOctokit(client, { pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("org/repo", 42, "Nit", "src/a.ts", 10);

    expect(id).toBe(777);
    expect(createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      body: "Nit",
      path: "src/a.ts",
      line: 10,
      side: "RIGHT",
      commit_id: "sha1",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, path: "src/a.ts", line: 10, commentId: 777 },
      "Created PR review comment",
    );
  });

  it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi
      .fn()
      .mockRejectedValueOnce(withStatus(new Error("line not in diff"), 422))
      .mockResolvedValueOnce({ data: { id: 778 } });
    installFakeOctokit(client, { pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("org/repo", 42, "Nit", "src/a.ts", 10);

    expect(id).toBe(778);
    expect(createReviewComment).toHaveBeenNthCalledWith(2, {
      owner: "org",
      repo: "repo",
      pull_number: 42,
      body: "*(line 10)* Nit",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha1",
    });
  });

  it("rethrows a wrapped error when the line-level attempt fails with a non-422 error (no fallback)", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockRejectedValue(new Error("unexpected failure"));
    installFakeOctokit(client, { pulls: { get, createReviewComment } });

    await expect(
      client.createPRReviewComment("org/repo", 42, "Nit", "src/a.ts", 10),
    ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo".*unexpected failure/);
  });

  it("creates a file-level comment directly when no line is provided", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 900 } });
    installFakeOctokit(client, { pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("org/repo", 42, "General comment", "src/a.ts");

    expect(id).toBe(900);
    expect(createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      body: "General comment",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha1",
    });
  });

  it("returns 0 and logs a warning when the file-level comment fails with 422 (file not in diff)", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockRejectedValue(withStatus(new Error("not in diff"), 422));
    installFakeOctokit(client, { pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("org/repo", 42, "General comment", "src/a.ts");

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, path: "src/a.ts", line: undefined },
      "Could not post PR review comment (file may not be in diff), skipping",
    );
  });

  it("throws a wrapped error when fetching the PR itself fails", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const get = vi.fn().mockRejectedValue(new Error("pr not found"));
    installFakeOctokit(client, { pulls: { get, createReviewComment: vi.fn() } });

    await expect(
      client.createPRReviewComment("org/repo", 42, "Nit", "src/a.ts", 10),
    ).rejects.toThrow(/GitHub createPRReviewComment failed for "org\/repo".*pr not found/);
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("posts a reply to an existing review comment", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createReplyForReviewComment = vi.fn().mockResolvedValue({ data: {} });
    installFakeOctokit(client, { pulls: { createReplyForReviewComment } });

    await client.replyToReviewComment("org/repo", 42, 777, "Thanks!");

    expect(createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      comment_id: 777,
      body: "Thanks!",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, commentId: 777 },
      "Replied to PR review comment",
    );
  });

  it("swallows the error and logs a warning when the reply fails", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createReplyForReviewComment = vi.fn().mockRejectedValue(new Error("comment deleted"));
    installFakeOctokit(client, { pulls: { createReplyForReviewComment } });

    await expect(
      client.replyToReviewComment("org/repo", 42, 777, "Thanks!"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, commentId: 777, error: "comment deleted" },
      "Failed to reply to PR review comment, skipping",
    );
  });

  it("stringifies a non-Error rejection in the warning log", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createReplyForReviewComment = vi.fn().mockRejectedValue("plain failure");
    installFakeOctokit(client, { pulls: { createReplyForReviewComment } });

    await client.replyToReviewComment("org/repo", 42, 777, "Thanks!");

    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, commentId: 777, error: "plain failure" },
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits a review with the given event", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createReview = vi.fn().mockResolvedValue({ data: {} });
    installFakeOctokit(client, { pulls: { createReview } });

    await client.submitPRReview("org/repo", 42, "LGTM", "APPROVE");

    expect(createReview).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      body: "LGTM",
      event: "APPROVE",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, event: "APPROVE" },
      "Submitted PR review",
    );
  });

  it("falls back to COMMENT when REQUEST_CHANGES fails because it's the author's own PR", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({ data: {} });
    installFakeOctokit(client, { pulls: { createReview } });

    await expect(
      client.submitPRReview("org/repo", 42, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();

    expect(createReview).toHaveBeenNthCalledWith(2, {
      owner: "org",
      repo: "repo",
      pull_number: 42,
      body: "Needs work",
      event: "COMMENT",
    });
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42, originalEvent: "REQUEST_CHANGES" },
      "Cannot request changes on own PR, falling back to COMMENT",
    );
  });

  it("throws a wrapped error for REQUEST_CHANGES failures unrelated to own-PR restriction", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const createReview = vi.fn().mockRejectedValue(new Error("service unavailable"));
    installFakeOctokit(client, { pulls: { createReview } });

    await expect(
      client.submitPRReview("org/repo", 42, "Needs work", "REQUEST_CHANGES"),
    ).rejects.toThrow(/GitHub submitPRReview failed for "org\/repo".*service unavailable/);
  });

  it("stringifies a non-Error rejection when checking for the own-PR restriction message", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const createReview = vi.fn().mockRejectedValue("plain string failure");
    installFakeOctokit(client, { pulls: { createReview } });

    await expect(
      client.submitPRReview("org/repo", 42, "Needs work", "REQUEST_CHANGES"),
    ).rejects.toThrow(/GitHub submitPRReview failed for "org\/repo".*plain string failure/);
  });

  it("throws a wrapped error when a COMMENT review itself fails (no fallback for COMMENT)", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const createReview = vi
      .fn()
      .mockRejectedValue(new Error("Can not request changes on your own pull request"));
    installFakeOctokit(client, { pulls: { createReview } });

    await expect(client.submitPRReview("org/repo", 42, "Just a note", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed for "org\/repo"/,
    );
  });
});
