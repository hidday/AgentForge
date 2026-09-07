import { describe, it, expect, vi } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeClient(octokit: Record<string, unknown>) {
  const logger = makeLogger();
  const client = new RealGitHubClient("token", logger as never);
  (client as unknown as { octokit: unknown }).octokit = octokit;
  return { client, logger };
}

describe("RealGitHubClient repo format validation", () => {
  it("throws for a repo string missing the owner/repo slash", async () => {
    const { client } = makeClient({});
    await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
      /Invalid repo format "not-a-valid-repo"/,
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves when the repo is accessible", async () => {
    const get = vi.fn().mockResolvedValue({ data: {} });
    const { client, logger } = makeClient({ repos: { get } });

    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledWith({ owner: "acme", repo: "repo" });
    expect(logger.debug).toHaveBeenCalled();
  });

  it("wraps and rethrows with a helpful message on failure", async () => {
    const get = vi.fn().mockRejectedValue(new Error("404 Not Found"));
    const { client } = makeClient({ repos: { get } });

    await expect(client.verifyRepoAccess("acme/repo")).rejects.toThrow(
      /GitHub: cannot access repo "acme\/repo".*404 Not Found/,
    );
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the default branch name", async () => {
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "develop" } });
    const { client } = makeClient({ repos: { get } });

    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("develop");
  });

  it("wraps errors with the operation name and repo", async () => {
    const get = vi.fn().mockRejectedValue(new Error("boom"));
    const { client } = makeClient({ repos: { get } });

    await expect(client.getDefaultBranch("acme/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "acme\/repo".*boom/,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates a ref from the default branch's sha", async () => {
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } });
    const createRef = vi.fn().mockResolvedValue({});
    const { client, logger } = makeClient({ repos: { get }, git: { getRef, createRef } });

    await client.createBranch("acme/repo", "ai/feature");

    expect(getRef).toHaveBeenCalledWith({ owner: "acme", repo: "repo", ref: "heads/main" });
    expect(createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      ref: "refs/heads/ai/feature",
      sha: "sha123",
    });
    expect(logger.debug).toHaveBeenCalled();
  });

  it("swallows a 422 (branch already exists) and logs info instead of throwing", async () => {
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } });
    const createRef = vi.fn().mockRejectedValue(Object.assign(new Error("exists"), { status: 422 }));
    const { client, logger } = makeClient({ repos: { get }, git: { getRef, createRef } });

    await expect(client.createBranch("acme/repo", "ai/feature")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/repo", branchName: "ai/feature" },
      "Branch already exists on GitHub, continuing",
    );
  });

  it("wraps and rethrows non-422 errors", async () => {
    const get = vi.fn().mockResolvedValue({ data: { default_branch: "main" } });
    const getRef = vi.fn().mockRejectedValue(new Error("network down"));
    const { client } = makeClient({ repos: { get }, git: { getRef, createRef: vi.fn() } });

    await expect(client.createBranch("acme/repo", "ai/feature")).rejects.toThrow(
      /GitHub createBranch failed for "acme\/repo".*network down/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates a draft PR and returns its number", async () => {
    const create = vi.fn().mockResolvedValue({ data: { number: 7 } });
    const { client } = makeClient({ pulls: { create } });

    const prNumber = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(7);
    expect(create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      head: "head",
      base: "main",
      title: "Title",
      body: "Body",
      draft: true,
    });
  });

  it("throws a wrapped error for a 422 field-validation failure (invalid base branch)", async () => {
    const err = Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 });
    const create = vi.fn().mockRejectedValue(err);
    const { client, logger } = makeClient({ pulls: { create, list: vi.fn() } });

    await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
      /GitHub createDraftPR failed/,
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("falls back to finding an existing open PR on 422 duplicate-head errors", async () => {
    const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
    const create = vi.fn().mockRejectedValue(err);
    const list = vi.fn().mockResolvedValue({ data: [{ number: 55 }] });
    const { client, logger } = makeClient({ pulls: { create, list } });

    const prNumber = await client.createDraftPR("acme/repo", "head", "main", "T", "B");

    expect(prNumber).toBe(55);
    expect(list).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      head: "acme:head",
      base: "main",
      state: "open",
    });
    expect(logger.info).toHaveBeenCalledWith({ repo: "acme/repo", prNumber: 55 }, "Found existing open PR");
  });

  it("throws a wrapped error when 422 duplicate lookup finds no existing PR", async () => {
    const err = Object.assign(new Error("A pull request already exists"), { status: 422 });
    const create = vi.fn().mockRejectedValue(err);
    const list = vi.fn().mockResolvedValue({ data: [] });
    const { client } = makeClient({ pulls: { create, list } });

    await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
      /GitHub createDraftPR failed/,
    );
  });

  it("wraps and rethrows non-422 errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("timeout"));
    const { client } = makeClient({ pulls: { create } });

    await expect(client.createDraftPR("acme/repo", "head", "main", "T", "B")).rejects.toThrow(
      /GitHub createDraftPR failed.*timeout/,
    );
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("posts an issue comment on the PR", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ issues: { createComment } });

    await client.commentOnPR("acme/repo", 3, "hello");

    expect(createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      issue_number: 3,
      body: "hello",
    });
  });

  it("wraps errors with the PR number", async () => {
    const createComment = vi.fn().mockRejectedValue(new Error("rate limited"));
    const { client } = makeClient({ issues: { createComment } });

    await expect(client.commentOnPR("acme/repo", 3, "hello")).rejects.toThrow(
      /GitHub commentOnPR failed.*rate limited/,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("returns the diff text", async () => {
    const get = vi.fn().mockResolvedValue({ data: "diff --git a/x b/x" });
    const { client } = makeClient({ pulls: { get } });

    await expect(client.getPRDiff("acme/repo", 3)).resolves.toBe("diff --git a/x b/x");
  });

  it("wraps errors with the PR number", async () => {
    const get = vi.fn().mockRejectedValue(new Error("gone"));
    const { client } = makeClient({ pulls: { get } });

    await expect(client.getPRDiff("acme/repo", 3)).rejects.toThrow(/GitHub getPRDiff failed.*gone/);
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("marks a draft PR ready via the GraphQL mutation", async () => {
    const get = vi.fn().mockResolvedValue({ data: { draft: true, node_id: "PR_123" } });
    const graphql = vi.fn().mockResolvedValue({});
    const { client, logger } = makeClient({ pulls: { get }, graphql });

    await client.markPRReady("acme/repo", 3);

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "PR_123",
    });
    expect(logger.debug).toHaveBeenCalled();
  });

  it("is a no-op (skips the mutation) when the PR is already not a draft", async () => {
    const get = vi.fn().mockResolvedValue({ data: { draft: false, node_id: "PR_123" } });
    const graphql = vi.fn();
    const { client } = makeClient({ pulls: { get }, graphql });

    await client.markPRReady("acme/repo", 3);

    expect(graphql).not.toHaveBeenCalled();
  });

  it("wraps errors", async () => {
    const get = vi.fn().mockRejectedValue(new Error("not found"));
    const { client } = makeClient({ pulls: { get }, graphql: vi.fn() });

    await expect(client.markPRReady("acme/repo", 3)).rejects.toThrow(/GitHub markPRReady failed/);
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps comments, defaulting missing author/body", async () => {
    const listComments = vi.fn().mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
      ],
    });
    const { client } = makeClient({ issues: { listComments } });

    const comments = await client.listPRComments("acme/repo", 3);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("wraps errors", async () => {
    const listComments = vi.fn().mockRejectedValue(new Error("denied"));
    const { client } = makeClient({ issues: { listComments } });

    await expect(client.listPRComments("acme/repo", 3)).rejects.toThrow(
      /GitHub listPRComments failed.*denied/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-level comment when line is provided", async () => {
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 500 } });
    const { client } = makeClient({ pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("acme/repo", 3, "fix this", "src/a.ts", 10);

    expect(id).toBe(500);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 10, side: "RIGHT", commit_id: "sha1" }),
    );
  });

  it("creates a file-level comment when no line is provided", async () => {
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 501 } });
    const { client } = makeClient({ pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("acme/repo", 3, "general note", "src/a.ts");

    expect(id).toBe(501);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "file", path: "src/a.ts" }),
    );
  });

  it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const lineErr = Object.assign(new Error("not in diff"), { status: 422 });
    const createReviewComment = vi
      .fn()
      .mockRejectedValueOnce(lineErr)
      .mockResolvedValueOnce({ data: { id: 502 } });
    const { client, logger } = makeClient({ pulls: { get, createReviewComment } });

    const id = await client.createPRReviewComment("acme/repo", 3, "note", "src/a.ts", 99);

    expect(id).toBe(502);
    expect(createReviewComment).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 99 }),
      "Line not in PR diff, falling back to file-level comment",
    );
  });

  it("rethrows a non-422 error from the line-level attempt", async () => {
    const get = vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } });
    const createReviewComment = vi.fn().mockRejectedValue(new Error("server error"));
    const { client } = makeClient({ pulls: { get, createReviewComment } });

    await expect(
      client.createPRReviewComment("acme/repo", 3, "note", "src/a.ts", 99),
    ).rejects.toThrow(/GitHub createPRReviewComment failed.*server error/);
  });

  it("returns 0 and logs a warning when the outer request 422s (file not in diff)", async () => {
    const err = Object.assign(new Error("file not in diff"), { status: 422 });
    const get = vi.fn().mockRejectedValue(err);
    const { client, logger } = makeClient({ pulls: { get, createReviewComment: vi.fn() } });

    const id = await client.createPRReviewComment("acme/repo", 3, "note", "src/missing.ts");

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/missing.ts" }),
      "Could not post PR review comment (file may not be in diff), skipping",
    );
  });

  it("wraps a non-422 error from the outer pulls.get call", async () => {
    const get = vi.fn().mockRejectedValue(new Error("unauthorized"));
    const { client } = makeClient({ pulls: { get, createReviewComment: vi.fn() } });

    await expect(
      client.createPRReviewComment("acme/repo", 3, "note", "src/a.ts"),
    ).rejects.toThrow(/GitHub createPRReviewComment failed.*unauthorized/);
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("posts the reply", async () => {
    const createReplyForReviewComment = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ pulls: { createReplyForReviewComment } });

    await client.replyToReviewComment("acme/repo", 3, 500, "thanks, fixed");

    expect(createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      pull_number: 3,
      comment_id: 500,
      body: "thanks, fixed",
    });
  });

  it("logs a warning and does not throw when the reply fails", async () => {
    const createReplyForReviewComment = vi.fn().mockRejectedValue(new Error("comment deleted"));
    const { client, logger } = makeClient({ pulls: { createReplyForReviewComment } });

    await expect(
      client.replyToReviewComment("acme/repo", 3, 500, "thanks"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 500, error: "comment deleted" }),
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits a review with the given event", async () => {
    const createReview = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ pulls: { createReview } });

    await client.submitPRReview("acme/repo", 3, "lgtm", "APPROVE");

    expect(createReview).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      pull_number: 3,
      body: "lgtm",
      event: "APPROVE",
    });
  });

  it("falls back to COMMENT when requesting changes on one's own PR", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({});
    const { client, logger } = makeClient({ pulls: { createReview } });

    await client.submitPRReview("acme/repo", 3, "needs work", "REQUEST_CHANGES");

    expect(createReview).toHaveBeenCalledTimes(2);
    expect(createReview).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "COMMENT", body: "needs work" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ originalEvent: "REQUEST_CHANGES" }),
      "Cannot request changes on own PR, falling back to COMMENT",
    );
  });

  it("wraps and rethrows other errors without falling back", async () => {
    const createReview = vi.fn().mockRejectedValue(new Error("service unavailable"));
    const { client } = makeClient({ pulls: { createReview } });

    await expect(client.submitPRReview("acme/repo", 3, "lgtm", "APPROVE")).rejects.toThrow(
      /GitHub submitPRReview failed.*service unavailable/,
    );
  });

  it("does not fall back for the own-PR message when the event is already COMMENT", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValue(new Error("Can not request changes on your own pull request"));
    const { client } = makeClient({ pulls: { createReview } });

    await expect(client.submitPRReview("acme/repo", 3, "note", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
    expect(createReview).toHaveBeenCalledTimes(1);
  });
});
