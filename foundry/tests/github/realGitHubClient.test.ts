import { describe, it, expect, vi } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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

function buildClient() {
  const logger = makeLogger();
  const client = new RealGitHubClient("test-token", logger as never);
  const octokit = makeOctokit();
  (client as unknown as { octokit: typeof octokit }).octokit = octokit;
  return { client, octokit, logger };
}

function httpError(status: number, message = "GitHub error") {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient repo format validation", () => {
  it("rejects a repo string without an owner/name split", async () => {
    const { client } = buildClient();
    await expect(client.getDefaultBranch("not-a-valid-repo")).rejects.toThrow(
      /Invalid repo format/,
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves when the repo is accessible", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockResolvedValue({ data: {} });
    await expect(client.verifyRepoAccess("acme/backend")).resolves.toBeUndefined();
  });

  it("wraps the error with a permissions hint when access fails", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockRejectedValue(new Error("Not Found"));
    await expect(client.verifyRepoAccess("acme/backend")).rejects.toThrow(
      /cannot access repo "acme\/backend"/,
    );
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the default branch name", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    expect(await client.getDefaultBranch("acme/backend")).toBe("main");
  });

  it("wraps the error on failure", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockRejectedValue(new Error("boom"));
    await expect(client.getDefaultBranch("acme/backend")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "acme\/backend"/,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates a branch from the default branch's ref", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
    octokit.git.createRef.mockResolvedValue({ data: {} });

    await client.createBranch("acme/backend", "ai/run-1");

    expect(octokit.git.createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "backend",
      ref: "refs/heads/ai/run-1",
      sha: "sha123",
    });
  });

  it("treats a 422 (branch already exists) as success", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha123" } } });
    octokit.git.createRef.mockRejectedValue(httpError(422));

    await expect(client.createBranch("acme/backend", "ai/run-1")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/backend", branchName: "ai/run-1" },
      "Branch already exists on GitHub, continuing",
    );
  });

  it("wraps other errors", async () => {
    const { client, octokit } = buildClient();
    octokit.repos.get.mockRejectedValue(new Error("rate limited"));
    await expect(client.createBranch("acme/backend", "ai/run-1")).rejects.toThrow(
      /GitHub createBranch failed/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates a draft PR and returns its number", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.create.mockResolvedValue({ data: { number: 42 } });

    const prNumber = await client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body");

    expect(prNumber).toBe(42);
    expect(octokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: "ai/run-1", base: "main", draft: true }),
    );
  });

  it("throws a wrapped validation error for an invalid-field 422", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.pulls.create.mockRejectedValue(
      httpError(422, 'Validation Failed: {"code":"invalid","field":"base"}'),
    );

    await expect(
      client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
    expect(logger.error).toHaveBeenCalled();
  });

  it("looks up and returns an existing open PR on a duplicate-head 422", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 99 }] });

    const prNumber = await client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body");
    expect(prNumber).toBe(99);
  });

  it("throws when a duplicate-head 422 occurs but no existing open PR is found", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [] });

    await expect(
      client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });

  it("wraps a non-422 error", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.create.mockRejectedValue(new Error("server error"));
    await expect(
      client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("posts a comment", async () => {
    const { client, octokit } = buildClient();
    octokit.issues.createComment.mockResolvedValue({ data: {} });
    await client.commentOnPR("acme/backend", 5, "hello");
    expect(octokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 5, body: "hello" }),
    );
  });

  it("wraps the error on failure", async () => {
    const { client, octokit } = buildClient();
    octokit.issues.createComment.mockRejectedValue(new Error("boom"));
    await expect(client.commentOnPR("acme/backend", 5, "hello")).rejects.toThrow(
      /GitHub commentOnPR failed/,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("returns the diff text", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
    expect(await client.getPRDiff("acme/backend", 5)).toBe("diff --git a/x b/x");
  });

  it("wraps the error on failure", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockRejectedValue(new Error("boom"));
    await expect(client.getPRDiff("acme/backend", 5)).rejects.toThrow(/GitHub getPRDiff failed/);
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("does nothing when the PR is already not a draft", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { draft: false } });
    await client.markPRReady("acme/backend", 5);
    expect(octokit.graphql).not.toHaveBeenCalled();
  });

  it("fires the ready-for-review mutation when the PR is a draft", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    octokit.graphql.mockResolvedValue({});

    await client.markPRReady("acme/backend", 5);

    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
  });

  it("wraps the error on failure", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockRejectedValue(new Error("boom"));
    await expect(client.markPRReady("acme/backend", 5)).rejects.toThrow(/GitHub markPRReady failed/);
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps comments, defaulting missing user/body", async () => {
    const { client, octokit } = buildClient();
    octokit.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
      ],
    });

    const comments = await client.listPRComments("acme/backend", 5);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("wraps the error on failure", async () => {
    const { client, octokit } = buildClient();
    octokit.issues.listComments.mockRejectedValue(new Error("boom"));
    await expect(client.listPRComments("acme/backend", 5)).rejects.toThrow(
      /GitHub listPRComments failed/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-level comment when a line is given", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 101 } });

    const id = await client.createPRReviewComment("acme/backend", 5, "nit", "src/a.ts", 10);

    expect(id).toBe(101);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 10, side: "RIGHT", commit_id: "sha1" }),
    );
  });

  it("creates a file-level comment when no line is given", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 102 } });

    const id = await client.createPRReviewComment("acme/backend", 5, "general", "src/a.ts");

    expect(id).toBe(102);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "file" }),
    );
  });

  it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ data: { id: 103 } });

    const id = await client.createPRReviewComment("acme/backend", 5, "nit", "src/a.ts", 10);

    expect(id).toBe(103);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 10 }),
      "Line not in PR diff, falling back to file-level comment",
    );
    const fallbackCall = octokit.pulls.createReviewComment.mock.calls[1][0] as { body: string };
    expect(fallbackCall.body).toContain("(line 10)");
  });

  it("rethrows a non-422 error from the line-level attempt", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    octokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));

    await expect(
      client.createPRReviewComment("acme/backend", 5, "nit", "src/a.ts", 10),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });

  it("returns 0 when the whole operation 422s (file not in diff)", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.pulls.get.mockRejectedValue(httpError(422));

    const id = await client.createPRReviewComment("acme/backend", 5, "nit", "src/a.ts");
    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts" }),
      "Could not post PR review comment (file may not be in diff), skipping",
    );
  });

  it("wraps a non-422 outer error", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.get.mockRejectedValue(new Error("boom"));
    await expect(client.createPRReviewComment("acme/backend", 5, "nit", "src/a.ts")).rejects.toThrow(
      /GitHub createPRReviewComment failed/,
    );
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("replies to the comment", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
    await client.replyToReviewComment("acme/backend", 5, 101, "thanks");
    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 101, body: "thanks" }),
    );
  });

  it("swallows the error and logs a warning on failure", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("boom"));
    await expect(client.replyToReviewComment("acme/backend", 5, 101, "thanks")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 101, error: "boom" }),
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits a review with the given event", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.createReview.mockResolvedValue({ data: {} });
    await client.submitPRReview("acme/backend", 5, "LGTM", "APPROVE");
    expect(octokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: "APPROVE", body: "LGTM" }),
    );
  });

  it("falls back to COMMENT when requesting changes on one's own PR is rejected", async () => {
    const { client, octokit, logger } = buildClient();
    octokit.pulls.createReview
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({ data: {} });

    await client.submitPRReview("acme/backend", 5, "Needs fixes", "REQUEST_CHANGES");

    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
    expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ event: "COMMENT" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ originalEvent: "REQUEST_CHANGES" }),
      "Cannot request changes on own PR, falling back to COMMENT",
    );
  });

  it("wraps other errors", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.createReview.mockRejectedValue(new Error("server error"));
    await expect(client.submitPRReview("acme/backend", 5, "body", "APPROVE")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });

  it("does not retry the own-PR fallback when the event is already COMMENT", async () => {
    const { client, octokit } = buildClient();
    octokit.pulls.createReview.mockRejectedValue(
      new Error("Can not request changes on your own pull request"),
    );
    await expect(client.submitPRReview("acme/backend", 5, "body", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });
});
