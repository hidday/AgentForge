import { describe, it, expect, vi } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function setOctokit(client: RealGitHubClient, octokit: Record<string, unknown>) {
  (client as unknown as { octokit: Record<string, unknown> }).octokit = octokit;
}

function httpError(status: number, message = "error") {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient repo format validation", () => {
  it("rejects a repo string that is not owner/repo", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
      /Invalid repo format/,
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves when the repo is accessible", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { repos: { get: vi.fn().mockResolvedValue({ data: {} }) } });

    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("wraps the error with a helpful message on failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { repos: { get: vi.fn().mockRejectedValue(new Error("404 Not Found")) } });

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /cannot access repo "org\/repo"/,
    );
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the repo's default branch", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
    });

    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("wraps the error on failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { repos: { get: vi.fn().mockRejectedValue(new Error("boom")) } });

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed/,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates a ref from the default branch's sha", async () => {
    const createRef = vi.fn().mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } }),
        createRef,
      },
    });

    await client.createBranch("org/repo", "feature/x");

    expect(createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/feature/x",
      sha: "sha123",
    });
  });

  it("treats a 422 as 'branch already exists' and does not throw", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    setOctokit(client, {
      repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }) },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "sha123" } } }),
        createRef: vi.fn().mockRejectedValue(httpError(422)),
      },
    });

    await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", branchName: "feature/x" },
      "Branch already exists on GitHub, continuing",
    );
  });

  it("wraps and rethrows a non-422 error", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      repos: { get: vi.fn().mockRejectedValue(new Error("down")) },
    });

    await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
      /GitHub createBranch failed/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates a draft PR and returns its number", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: { create: vi.fn().mockResolvedValue({ data: { number: 42 } }) },
    });

    await expect(client.createDraftPR("org/repo", "head", "main", "title", "body")).resolves.toBe(
      42,
    );
  });

  it("throws a wrapped error for a 422 field-validation failure", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    setOctokit(client, {
      pulls: {
        create: vi
          .fn()
          .mockRejectedValue(httpError(422, '{"code":"invalid","field":"base"}')),
      },
    });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "title", "body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
    expect(logger.error).toHaveBeenCalled();
  });

  it("falls back to the existing open PR when one is found for the head branch", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: {
        create: vi.fn().mockRejectedValue(httpError(422, "pull request already exists")),
        list: vi.fn().mockResolvedValue({ data: [{ number: 77 }] }),
      },
    });

    await expect(client.createDraftPR("org/repo", "head", "main", "title", "body")).resolves.toBe(
      77,
    );
  });

  it("rethrows when a 422 occurs but no existing PR is found", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: {
        create: vi.fn().mockRejectedValue(httpError(422, "pull request already exists")),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "title", "body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });

  it("wraps a non-422 error", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { create: vi.fn().mockRejectedValue(new Error("down")) } });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "title", "body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("creates a comment on the PR's issue thread", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { issues: { createComment } });

    await client.commentOnPR("org/repo", 1, "hello");

    expect(createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 1,
      body: "hello",
    });
  });

  it("wraps errors", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { issues: { createComment: vi.fn().mockRejectedValue(new Error("x")) } });

    await expect(client.commentOnPR("org/repo", 1, "hello")).rejects.toThrow(
      /GitHub commentOnPR failed/,
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("returns the diff text", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { get: vi.fn().mockResolvedValue({ data: "diff content" }) } });

    await expect(client.getPRDiff("org/repo", 1)).resolves.toBe("diff content");
  });

  it("wraps errors", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("x")) } });

    await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("is a no-op when the PR is already not a draft", async () => {
    const graphql = vi.fn();
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { get: vi.fn().mockResolvedValue({ data: { draft: false } }) }, graphql });

    await client.markPRReady("org/repo", 1);

    expect(graphql).not.toHaveBeenCalled();
  });

  it("issues the markPullRequestReadyForReview mutation when draft", async () => {
    const graphql = vi.fn().mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { draft: true, node_id: "node-1" } }) },
      graphql,
    });

    await client.markPRReady("org/repo", 1);

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
  });

  it("wraps errors", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("x")) } });

    await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(/GitHub markPRReady failed/);
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps comments, defaulting missing author and body", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      issues: {
        listComments: vi.fn().mockResolvedValue({
          data: [
            { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
            { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
          ],
        }),
      },
    });

    const comments = await client.listPRComments("org/repo", 1);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("wraps errors", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { issues: { listComments: vi.fn().mockRejectedValue(new Error("x")) } });

    await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(
      /GitHub listPRComments failed/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-level comment when a line is given", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 55 } });
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);

    expect(id).toBe(55);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 10, side: "RIGHT", commit_id: "sha1" }),
    );
  });

  it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
    const logger = makeLogger();
    const createReviewComment = vi
      .fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ data: { id: 56 } });
    const client = new RealGitHubClient("token", logger as never);
    setOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);

    expect(id).toBe(56);
    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 1, path: "src/a.ts", line: 10 },
      "Line not in PR diff, falling back to file-level comment",
    );
    expect(createReviewComment).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-422 error from the line-level attempt", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }),
        createReviewComment: vi.fn().mockRejectedValue(new Error("down")),
      },
    });

    await expect(
      client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });

  it("creates a file-level comment directly when no line is given", async () => {
    const createReviewComment = vi.fn().mockResolvedValue({ data: { id: 57 } });
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, {
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: "sha1" } } }), createReviewComment },
    });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts");

    expect(id).toBe(57);
    expect(createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "file" }),
    );
  });

  it("swallows a 422 at the outer level and returns 0", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    setOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(httpError(422)) } });

    const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts");

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("wraps a non-422 outer error", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { get: vi.fn().mockRejectedValue(new Error("down")) } });

    await expect(
      client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts"),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("replies to the review comment", async () => {
    const createReply = vi.fn().mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { createReplyForReviewComment: createReply } });

    await client.replyToReviewComment("org/repo", 1, 100, "thanks");

    expect(createReply).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 100, body: "thanks" }),
    );
  });

  it("swallows errors and logs a warning instead of throwing", async () => {
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger as never);
    setOctokit(client, {
      pulls: { createReplyForReviewComment: vi.fn().mockRejectedValue(new Error("gone")) },
    });

    await expect(client.replyToReviewComment("org/repo", 1, 100, "thanks")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits the review with the given event", async () => {
    const createReview = vi.fn().mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { createReview } });

    await client.submitPRReview("org/repo", 1, "lgtm", "APPROVE");

    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: "APPROVE", body: "lgtm" }),
    );
  });

  it("falls back to COMMENT when REQUEST_CHANGES is rejected for reviewing one's own PR", async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({});
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { createReview } });

    await client.submitPRReview("org/repo", 1, "needs work", "REQUEST_CHANGES");

    expect(createReview).toHaveBeenCalledTimes(2);
    expect(createReview).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "COMMENT" }),
    );
  });

  it("rethrows a wrapped error for any other failure", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    setOctokit(client, { pulls: { createReview: vi.fn().mockRejectedValue(new Error("down")) } });

    await expect(client.submitPRReview("org/repo", 1, "x", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });
});
