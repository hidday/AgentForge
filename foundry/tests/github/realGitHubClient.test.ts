import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOctokit = {
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

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => mockOctokit),
}));

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RealGitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a clear error when the repo string is not in owner/repo format", async () => {
    const client = new RealGitHubClient("token", makeLogger());
    await expect(client.verifyRepoAccess("not-a-valid-repo")).rejects.toThrow(
      /expected "owner\/repo"/,
    );
  });

  it("verifyRepoAccess resolves and logs debug on success", async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: {} });
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    await client.verifyRepoAccess("org/repo");

    expect(mockOctokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
    expect(logger.debug).toHaveBeenCalled();
  });

  it("verifyRepoAccess wraps the underlying error with a helpful message", async () => {
    mockOctokit.repos.get.mockRejectedValue(new Error("404 Not Found"));
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /cannot access repo "org\/repo".*404 Not Found/,
    );
  });

  it("getDefaultBranch returns the repo's default_branch", async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
  });

  it("getDefaultBranch wraps errors via wrapError", async () => {
    mockOctokit.repos.get.mockRejectedValue(new Error("boom"));
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "org\/repo".*boom/,
    );
  });

  it("createBranch resolves the default branch sha and creates a new ref", async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
    mockOctokit.git.createRef.mockResolvedValue({ data: {} });
    const client = new RealGitHubClient("token", makeLogger());

    await client.createBranch("org/repo", "ai/run-1");

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/ai/run-1",
      sha: "abc123",
    });
  });

  it("createBranch treats a 422 (branch already exists) as success and logs info", async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
    mockOctokit.git.createRef.mockRejectedValue({ status: 422 });
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    await expect(client.createBranch("org/repo", "ai/run-1")).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it("createBranch rethrows wrapped non-422 errors", async () => {
    mockOctokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    mockOctokit.git.getRef.mockRejectedValue(new Error("network down"));
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.createBranch("org/repo", "ai/run-1")).rejects.toThrow(
      /GitHub createBranch failed/,
    );
  });

  it("createDraftPR returns the new PR number on success", async () => {
    mockOctokit.pulls.create.mockResolvedValue({ data: { number: 42 } });
    const client = new RealGitHubClient("token", makeLogger());

    await expect(
      client.createDraftPR("org/repo", "ai/run-1", "main", "Title", "Body"),
    ).resolves.toBe(42);
  });

  it("createDraftPR throws when a 422 is a field-validation error (invalid base branch)", async () => {
    mockOctokit.pulls.create.mockRejectedValue(
      Object.assign(new Error('{"code":"invalid","field":"base"}'), { status: 422 }),
    );
    const client = new RealGitHubClient("token", makeLogger());

    await expect(
      client.createDraftPR("org/repo", "ai/run-1", "bad-base", "Title", "Body"),
    ).rejects.toThrow(/createDraftPR failed/);
  });

  it("createDraftPR falls back to an existing open PR when 422 means 'PR already exists'", async () => {
    mockOctokit.pulls.create.mockRejectedValue({ status: 422, message: "already exists" });
    mockOctokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });
    const client = new RealGitHubClient("token", makeLogger());

    await expect(
      client.createDraftPR("org/repo", "ai/run-1", "main", "Title", "Body"),
    ).resolves.toBe(55);
  });

  it("createDraftPR rethrows a wrapped error when no existing PR is found after a 422", async () => {
    mockOctokit.pulls.create.mockRejectedValue({ status: 422, message: "already exists" });
    mockOctokit.pulls.list.mockResolvedValue({ data: [] });
    const client = new RealGitHubClient("token", makeLogger());

    await expect(
      client.createDraftPR("org/repo", "ai/run-1", "main", "Title", "Body"),
    ).rejects.toThrow(/createDraftPR failed/);
  });

  it("commentOnPR posts a comment and wraps errors on failure", async () => {
    mockOctokit.issues.createComment.mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger());
    await client.commentOnPR("org/repo", 1, "hello");
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 1,
      body: "hello",
    });

    mockOctokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
    await expect(client.commentOnPR("org/repo", 1, "hello")).rejects.toThrow(
      /commentOnPR failed/,
    );
  });

  it("getPRDiff requests diff media type and returns the raw diff text", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.getPRDiff("org/repo", 3)).resolves.toBe("diff --git a b");
    expect(mockOctokit.pulls.get).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: { format: "diff" } }),
    );
  });

  it("markPRReady is a no-op when the PR is already not a draft", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false } });
    const client = new RealGitHubClient("token", makeLogger());

    await client.markPRReady("org/repo", 1);

    expect(mockOctokit.graphql).not.toHaveBeenCalled();
  });

  it("markPRReady calls the markAsReady GraphQL mutation for a draft PR", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    mockOctokit.graphql.mockResolvedValue({});
    const client = new RealGitHubClient("token", makeLogger());

    await client.markPRReady("org/repo", 1);

    expect(mockOctokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining("markPullRequestReadyForReview"),
      { prId: "node-1" },
    );
  });

  it("listPRComments maps octokit comments to the PRComment shape, defaulting missing fields", async () => {
    mockOctokit.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "nice", created_at: "2024-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
      ],
    });
    const client = new RealGitHubClient("token", makeLogger());

    const comments = await client.listPRComments("org/repo", 1);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "nice", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
    ]);
  });

  it("createPRReviewComment posts a line comment using the PR head sha", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 777 } });
    const client = new RealGitHubClient("token", makeLogger());

    const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10);

    expect(id).toBe(777);
    expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", line: 10, commit_id: "sha1" }),
    );
  });

  it("createPRReviewComment falls back to a file-level comment when the line is not in the diff (422)", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    mockOctokit.pulls.createReviewComment
      .mockRejectedValueOnce({ status: 422 })
      .mockResolvedValueOnce({ data: { id: 888 } });
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10);

    expect(id).toBe(888);
    expect(logger.warn).toHaveBeenCalled();
    expect(mockOctokit.pulls.createReviewComment).toHaveBeenLastCalledWith(
      expect.objectContaining({ subject_type: "file" }),
    );
  });

  it("createPRReviewComment rethrows a non-422 error from the line-level attempt", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    mockOctokit.pulls.createReviewComment.mockRejectedValue(new Error("server error"));
    const client = new RealGitHubClient("token", makeLogger());

    await expect(
      client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10),
    ).rejects.toThrow(/createPRReviewComment failed/);
  });

  it("createPRReviewComment without a line posts a file-level comment directly", async () => {
    mockOctokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
    mockOctokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 999 } });
    const client = new RealGitHubClient("token", makeLogger());

    const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts");

    expect(id).toBe(999);
    expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: "file" }),
    );
  });

  it("createPRReviewComment returns 0 and warns when the outer call 422s (file not in diff)", async () => {
    mockOctokit.pulls.get.mockRejectedValue({ status: 422 });
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    const id = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts");

    expect(id).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("replyToReviewComment swallows errors and logs a warning instead of throwing", async () => {
    mockOctokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("gone"));
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    await expect(
      client.replyToReviewComment("org/repo", 1, 100, "thanks"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("submitPRReview falls back to COMMENT when requesting changes on your own PR", async () => {
    mockOctokit.pulls.createReview
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({});
    const logger = makeLogger();
    const client = new RealGitHubClient("token", logger);

    await client.submitPRReview("org/repo", 1, "body", "REQUEST_CHANGES");

    expect(mockOctokit.pulls.createReview).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "COMMENT" }),
    );
    expect(logger.info).toHaveBeenCalled();
  });

  it("submitPRReview rethrows a wrapped error for any other failure", async () => {
    mockOctokit.pulls.createReview.mockRejectedValue(new Error("validation failed"));
    const client = new RealGitHubClient("token", makeLogger());

    await expect(client.submitPRReview("org/repo", 1, "body", "APPROVE")).rejects.toThrow(
      /submitPRReview failed/,
    );
  });
});
