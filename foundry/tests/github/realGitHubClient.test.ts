import { describe, it, expect, vi, beforeEach } from "vitest";
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

function withErrorStatus(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient repo helpers", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
  });

  it("verifyRepoAccess resolves when the repo is reachable", async () => {
    octokit.repos.get.mockResolvedValue({ data: {} });
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
  });

  it("verifyRepoAccess wraps the underlying error with guidance", async () => {
    octokit.repos.get.mockRejectedValue(new Error("404 Not Found"));
    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /cannot access repo "org\/repo".*GITHUB_TOKEN/,
    );
  });

  it("rejects an invalid repo format before calling the API", async () => {
    await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
      /Invalid repo format/,
    );
    expect(octokit.repos.get).not.toHaveBeenCalled();
  });

  it("getDefaultBranch returns the repo's default branch", async () => {
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("getDefaultBranch wraps errors", async () => {
    octokit.repos.get.mockRejectedValue(new Error("down"));
    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "org\/repo"/,
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-1" } } });
  });

  it("creates a ref from the default branch's head sha", async () => {
    octokit.git.createRef.mockResolvedValue({ data: {} });

    await client.createBranch("org/repo", "ai/issue-1");

    expect(octokit.git.getRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "heads/main",
    });
    expect(octokit.git.createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/ai/issue-1",
      sha: "sha-1",
    });
  });

  it("treats a 422 (branch already exists) as success", async () => {
    octokit.git.createRef.mockRejectedValue(withErrorStatus(422));

    await expect(client.createBranch("org/repo", "ai/issue-1")).resolves.toBeUndefined();
  });

  it("wraps non-422 errors", async () => {
    octokit.git.createRef.mockRejectedValue(new Error("network down"));

    await expect(client.createBranch("org/repo", "ai/issue-1")).rejects.toThrow(
      /GitHub createBranch failed for "org\/repo"/,
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
  });

  it("creates a draft PR and returns its number", async () => {
    octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(7);
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

  it("rethrows a 422 field-validation error without looking up an existing PR", async () => {
    octokit.pulls.create.mockRejectedValue(
      withErrorStatus(422, '{"code":"invalid","field":"base"}'),
    );

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
    expect(octokit.pulls.list).not.toHaveBeenCalled();
  });

  it("on a non-field-validation 422, returns the existing open PR for the head branch", async () => {
    octokit.pulls.create.mockRejectedValue(withErrorStatus(422, "pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(55);
    expect(octokit.pulls.list).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      head: "org:head",
      base: "main",
      state: "open",
    });
  });

  it("rethrows the 422 when no existing open PR is found", async () => {
    octokit.pulls.create.mockRejectedValue(withErrorStatus(422, "pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [] });

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });

  it("wraps non-422 errors", async () => {
    octokit.pulls.create.mockRejectedValue(new Error("network down"));

    await expect(
      client.createDraftPR("org/repo", "head", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });
});

describe("RealGitHubClient.commentOnPR / getPRDiff / markPRReady / listPRComments", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
  });

  it("commentOnPR posts an issue comment", async () => {
    octokit.issues.createComment.mockResolvedValue({ data: {} });

    await client.commentOnPR("org/repo", 1, "Hello");

    expect(octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 1,
      body: "Hello",
    });
  });

  it("commentOnPR wraps errors", async () => {
    octokit.issues.createComment.mockRejectedValue(new Error("down"));
    await expect(client.commentOnPR("org/repo", 1, "Hello")).rejects.toThrow(
      /GitHub commentOnPR failed/,
    );
  });

  it("getPRDiff returns the raw diff text", async () => {
    octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
    await expect(client.getPRDiff("org/repo", 1)).resolves.toBe("diff --git a b");
  });

  it("getPRDiff wraps errors", async () => {
    octokit.pulls.get.mockRejectedValue(new Error("down"));
    await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/GitHub getPRDiff failed/);
  });

  it("markPRReady is a no-op when the PR is not a draft", async () => {
    octokit.pulls.get.mockResolvedValue({ data: { draft: false } });

    await client.markPRReady("org/repo", 1);

    expect(octokit.graphql).not.toHaveBeenCalled();
  });

  it("markPRReady marks a draft PR as ready via the GraphQL mutation", async () => {
    octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    octokit.graphql.mockResolvedValue({});

    await client.markPRReady("org/repo", 1);

    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
  });

  it("markPRReady wraps errors", async () => {
    octokit.pulls.get.mockRejectedValue(new Error("down"));
    await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(/GitHub markPRReady failed/);
  });

  it("listPRComments maps comments, defaulting a missing author or body", async () => {
    octokit.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "Looks good", created_at: "2024-01-01" },
        { id: 2, user: null, body: null, created_at: "2024-01-02" },
      ],
    });

    const comments = await client.listPRComments("org/repo", 1);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "Looks good", createdAt: "2024-01-01" },
      { id: "2", author: "unknown", body: "", createdAt: "2024-01-02" },
    ]);
  });

  it("listPRComments wraps errors", async () => {
    octokit.issues.listComments.mockRejectedValue(new Error("down"));
    await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(
      /GitHub listPRComments failed/,
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
  });

  it("creates a line comment when a line is given", async () => {
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 10 } });

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 5);

    expect(id).toBe(10);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "Fix this",
      path: "src/a.ts",
      line: 5,
      side: "RIGHT",
      commit_id: "sha-1",
    });
  });

  it("creates a file-level comment when no line is given", async () => {
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 11 } });

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts");

    expect(id).toBe(11);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "Fix this",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha-1",
    });
  });

  it("falls back to a file-level comment when the line comment 422s", async () => {
    octokit.pulls.createReviewComment
      .mockRejectedValueOnce(withErrorStatus(422))
      .mockResolvedValueOnce({ data: { id: 12 } });

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 5);

    expect(id).toBe(12);
    expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "*(line 5)* Fix this",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha-1",
    });
  });

  it("rethrows a non-422 line-comment error", async () => {
    octokit.pulls.createReviewComment.mockRejectedValue(new Error("down"));

    await expect(
      client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 5),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });

  it("returns 0 when even the file-level fallback 422s", async () => {
    octokit.pulls.createReviewComment.mockRejectedValue(withErrorStatus(422));

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 5);

    expect(id).toBe(0);
  });

  it("returns 0 when the no-line path 422s outright", async () => {
    octokit.pulls.createReviewComment.mockRejectedValue(withErrorStatus(422));

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts");

    expect(id).toBe(0);
  });

  it("wraps a non-422 error from the no-line path", async () => {
    octokit.pulls.createReviewComment.mockRejectedValue(new Error("down"));

    await expect(
      client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts"),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });

  it("wraps an error from the initial pulls.get lookup", async () => {
    octokit.pulls.get.mockRejectedValue(new Error("down"));

    await expect(
      client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts"),
    ).rejects.toThrow(/GitHub createPRReviewComment failed/);
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("replies to the review comment", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const octokit = makeOctokit();
    octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
    (client as unknown as { octokit: unknown }).octokit = octokit;

    await client.replyToReviewComment("org/repo", 1, 10, "Thanks");

    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      comment_id: 10,
      body: "Thanks",
    });
  });

  it("swallows errors and logs a warning instead of throwing", async () => {
    const client = new RealGitHubClient("token", makeLogger() as never);
    const octokit = makeOctokit();
    octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));
    (client as unknown as { octokit: unknown }).octokit = octokit;

    await expect(client.replyToReviewComment("org/repo", 1, 10, "Thanks")).resolves.toBeUndefined();
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  let client: RealGitHubClient;
  let octokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeOctokit();
    (client as unknown as { octokit: unknown }).octokit = octokit;
  });

  it("submits the review with the given event", async () => {
    octokit.pulls.createReview.mockResolvedValue({ data: {} });

    await client.submitPRReview("org/repo", 1, "LGTM", "APPROVE");

    expect(octokit.pulls.createReview).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "LGTM",
      event: "APPROVE",
    });
  });

  it("falls back to COMMENT when REQUEST_CHANGES is rejected for reviewing one's own PR", async () => {
    octokit.pulls.createReview
      .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
      .mockResolvedValueOnce({ data: {} });

    await client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES");

    expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "Needs work",
      event: "COMMENT",
    });
  });

  it("rethrows a same-own-PR error when the event is already COMMENT", async () => {
    octokit.pulls.createReview.mockRejectedValue(
      new Error("Can not request changes on your own pull request"),
    );

    await expect(client.submitPRReview("org/repo", 1, "Note", "COMMENT")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });

  it("wraps unrelated errors", async () => {
    octokit.pulls.createReview.mockRejectedValue(new Error("network down"));

    await expect(client.submitPRReview("org/repo", 1, "LGTM", "APPROVE")).rejects.toThrow(
      /GitHub submitPRReview failed/,
    );
  });
});
