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

function httpError(status: number, message = "GitHub API error"): Error {
  return Object.assign(new Error(message), { status });
}

// A rejection value that is NOT an `Error` instance, to exercise the
// `err instanceof Error ? err.message : String(err)` false branch used
// throughout the client's error handling.
function nonErrorRejection(status?: number): { status?: number } {
  return status === undefined ? {} : { status };
}

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

function makeFakeOctokit(): FakeOctokit {
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

function makeClient(octokit: FakeOctokit) {
  const client = new RealGitHubClient("test-token", makeLogger() as never);
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
  return client;
}

describe("RealGitHubClient repo name parsing", () => {
  it("throws a descriptive error for a repo string without a slash", async () => {
    const client = makeClient(makeFakeOctokit());

    await expect(client.verifyRepoAccess("invalid-repo-name")).rejects.toThrow(
      'Invalid repo format "invalid-repo-name", expected "owner/repo"',
    );
  });
});

describe("RealGitHubClient.verifyRepoAccess", () => {
  it("resolves when the repo is accessible", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    const client = makeClient(octokit);

    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "org", repo: "repo" });
  });

  it("throws a wrapped error with cause when the repo cannot be accessed", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockRejectedValue(httpError(404, "Not Found"));
    const client = makeClient(octokit);

    let caught: unknown;
    try {
      await client.verifyRepoAccess("org/repo");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'GitHub: cannot access repo "org/repo". Check that GITHUB_TOKEN has repository access permissions. Original: Not Found',
    );
    expect((caught as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  it("stringifies a non-Error rejection", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockRejectedValue("plain string failure");
    const client = makeClient(octokit);

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      'Original: plain string failure',
    );
  });
});

describe("RealGitHubClient.getDefaultBranch", () => {
  it("returns the repo's default_branch", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
    const client = makeClient(octokit);

    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("develop");
  });

  it("throws a wrapped error on failure", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      'GitHub getDefaultBranch failed for "org/repo": Server error',
    );
  });

  it("stringifies a non-Error rejection when wrapping the error", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockRejectedValue(nonErrorRejection());
    const client = makeClient(octokit);

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      'GitHub getDefaultBranch failed for "org/repo": [object Object]',
    );
  });
});

describe("RealGitHubClient.createBranch", () => {
  it("creates a ref from the default branch's sha", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
    octokit.git.createRef.mockResolvedValue({ data: {} });
    const client = makeClient(octokit);

    await client.createBranch("org/repo", "ai/feature-1");

    expect(octokit.git.getRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "heads/main",
    });
    expect(octokit.git.createRef).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      ref: "refs/heads/ai/feature-1",
      sha: "abc123",
    });
  });

  it("logs and returns without throwing when the branch already exists (422)", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
    octokit.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));
    const client = makeClient(octokit);

    await expect(client.createBranch("org/repo", "ai/feature-1")).resolves.toBeUndefined();
  });

  it("throws a wrapped error for non-422 failures", async () => {
    const octokit = makeFakeOctokit();
    octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    octokit.git.getRef.mockRejectedValue(httpError(404, "Ref not found"));
    const client = makeClient(octokit);

    await expect(client.createBranch("org/repo", "ai/feature-1")).rejects.toThrow(
      'GitHub createBranch failed for "org/repo" {"branchName":"ai/feature-1"}: Ref not found',
    );
  });
});

describe("RealGitHubClient.createDraftPR", () => {
  it("creates a draft PR and returns its number", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });
    const client = makeClient(octokit);

    const result = await client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body");

    expect(result).toBe(7);
    expect(octokit.pulls.create).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      head: "head-branch",
      base: "main",
      title: "Title",
      body: "Body",
      draft: true,
    });
  });

  it("throws a wrapped error for a 422 caused by invalid field validation", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(
      httpError(422, 'Validation failed: {"code":"invalid","field":"base"}'),
    );
    const client = makeClient(octokit);

    await expect(
      client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
    ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
    expect(octokit.pulls.list).not.toHaveBeenCalled();
  });

  it("throws a wrapped error for a 422 caused by a missing_field validation", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(
      httpError(422, '{"code":"missing_field","field":"title"}'),
    );
    const client = makeClient(octokit);

    await expect(
      client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
    ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
  });

  it("returns the existing open PR number when one already exists for the head branch", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });
    const client = makeClient(octokit);

    const result = await client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body");

    expect(result).toBe(55);
    expect(octokit.pulls.list).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      head: "org:head-branch",
      base: "main",
      state: "open",
    });
  });

  it("throws a wrapped error when a duplicate-PR 422 has no matching open PR", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(httpError(422, "A pull request already exists"));
    octokit.pulls.list.mockResolvedValue({ data: [] });
    const client = makeClient(octokit);

    await expect(
      client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
    ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
  });

  it("throws a wrapped error for non-422 failures", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(
      client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body"),
    ).rejects.toThrow('GitHub createDraftPR failed for "org/repo"');
  });

  it("treats a non-Error 422 rejection as non-field-validation and looks up the existing PR", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.create.mockRejectedValue(nonErrorRejection(422));
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 61 }] });
    const client = makeClient(octokit);

    const result = await client.createDraftPR("org/repo", "head-branch", "main", "Title", "Body");

    expect(result).toBe(61);
    expect(octokit.pulls.list).toHaveBeenCalled();
  });
});

describe("RealGitHubClient.commentOnPR", () => {
  it("posts an issue comment on the PR", async () => {
    const octokit = makeFakeOctokit();
    octokit.issues.createComment.mockResolvedValue({ data: {} });
    const client = makeClient(octokit);

    await client.commentOnPR("org/repo", 1, "Nice work");

    expect(octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      issue_number: 1,
      body: "Nice work",
    });
  });

  it("throws a wrapped error on failure", async () => {
    const octokit = makeFakeOctokit();
    octokit.issues.createComment.mockRejectedValue(httpError(403, "Forbidden"));
    const client = makeClient(octokit);

    await expect(client.commentOnPR("org/repo", 1, "Nice work")).rejects.toThrow(
      'GitHub commentOnPR failed for "org/repo" {"prNumber":1}: Forbidden',
    );
  });
});

describe("RealGitHubClient.getPRDiff", () => {
  it("requests the diff media type and returns the raw diff text", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: "diff --git a/x b/x" });
    const client = makeClient(octokit);

    const diff = await client.getPRDiff("org/repo", 1);

    expect(diff).toBe("diff --git a/x b/x");
    expect(octokit.pulls.get).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      mediaType: { format: "diff" },
    });
  });

  it("throws a wrapped error on failure", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockRejectedValue(httpError(404, "Not Found"));
    const client = makeClient(octokit);

    await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(
      'GitHub getPRDiff failed for "org/repo" {"prNumber":1}: Not Found',
    );
  });
});

describe("RealGitHubClient.markPRReady", () => {
  it("does nothing when the PR is already not a draft", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { draft: false, node_id: "node-1" } });
    const client = makeClient(octokit);

    await client.markPRReady("org/repo", 1);

    expect(octokit.graphql).not.toHaveBeenCalled();
  });

  it("calls the markPullRequestReadyForReview mutation when the PR is a draft", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
    octokit.graphql.mockResolvedValue({});
    const client = makeClient(octokit);

    await client.markPRReady("org/repo", 1);

    expect(octokit.graphql).toHaveBeenCalledWith(expect.stringContaining("markPullRequestReadyForReview"), {
      prId: "node-1",
    });
  });

  it("throws a wrapped error on failure", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockRejectedValue(httpError(404, "Not Found"));
    const client = makeClient(octokit);

    await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(
      'GitHub markPRReady failed for "org/repo" {"prNumber":1}: Not Found',
    );
  });
});

describe("RealGitHubClient.listPRComments", () => {
  it("maps API comments to PRComment, defaulting missing fields", async () => {
    const octokit = makeFakeOctokit();
    octokit.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, user: { login: "alice" }, body: "First", created_at: "2024-01-01T00:00:00Z" },
        { id: 2, user: null, body: null, created_at: "2024-01-02T00:00:00Z" },
      ],
    });
    const client = makeClient(octokit);

    const comments = await client.listPRComments("org/repo", 1);

    expect(comments).toEqual([
      { id: "1", author: "alice", body: "First", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", author: "unknown", body: "", createdAt: "2024-01-02T00:00:00Z" },
    ]);
  });

  it("throws a wrapped error on failure", async () => {
    const octokit = makeFakeOctokit();
    octokit.issues.listComments.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(
      'GitHub listPRComments failed for "org/repo" {"prNumber":1}: Server error',
    );
  });
});

describe("RealGitHubClient.createPRReviewComment", () => {
  it("creates a line-level comment when a line number is given", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 500 } });
    const client = makeClient(octokit);

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10);

    expect(id).toBe(500);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "Fix this",
      path: "src/a.ts",
      line: 10,
      side: "RIGHT",
      commit_id: "sha-1",
    });
  });

  it("creates a file-level comment when no line number is given", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 501 } });
    const client = makeClient(octokit);

    const id = await client.createPRReviewComment("org/repo", 1, "General note", "src/a.ts");

    expect(id).toBe(501);
    expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "General note",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha-1",
    });
  });

  it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    octokit.pulls.createReviewComment
      .mockRejectedValueOnce(httpError(422, "line not in diff"))
      .mockResolvedValueOnce({ data: { id: 502 } });
    const client = makeClient(octokit);

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10);

    expect(id).toBe(502);
    expect(octokit.pulls.createReviewComment).toHaveBeenLastCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "*(line 10)* Fix this",
      path: "src/a.ts",
      subject_type: "file",
      commit_id: "sha-1",
    });
  });

  it("returns 0 when the file-level fallback also fails with 422", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    octokit.pulls.createReviewComment.mockRejectedValue(httpError(422, "still failing"));
    const client = makeClient(octokit);

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10);

    expect(id).toBe(0);
  });

  it("propagates a non-422 error from the line-comment attempt", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    octokit.pulls.createReviewComment.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(
      client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10),
    ).rejects.toThrow('GitHub createPRReviewComment failed for "org/repo"');
  });

  it("returns 0 when the initial pulls.get lookup itself fails with 422", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockRejectedValue(httpError(422, "not found"));
    const client = makeClient(octokit);

    const id = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10);

    expect(id).toBe(0);
  });

  it("throws a wrapped error when the initial pulls.get lookup fails with a non-422", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.get.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(
      client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 10),
    ).rejects.toThrow('GitHub createPRReviewComment failed for "org/repo"');
  });
});

describe("RealGitHubClient.replyToReviewComment", () => {
  it("posts a reply to the given review comment", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReplyForReviewComment.mockResolvedValue({ data: {} });
    const client = makeClient(octokit);

    await client.replyToReviewComment("org/repo", 1, 500, "Thanks!");

    expect(octokit.pulls.createReplyForReviewComment).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      comment_id: 500,
      body: "Thanks!",
    });
  });

  it("logs a warning and resolves (does not throw) when the reply fails", async () => {
    const octokit = makeFakeOctokit();
    const logger = makeLogger();
    octokit.pulls.createReplyForReviewComment.mockRejectedValue(httpError(404, "Not Found"));
    const client = new RealGitHubClient("test-token", logger as never);
    (client as unknown as { octokit: FakeOctokit }).octokit = octokit;

    await expect(
      client.replyToReviewComment("org/repo", 1, 500, "Thanks!"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "org/repo", prNumber: 1, commentId: 500, error: "Not Found" }),
      "Failed to reply to PR review comment, skipping",
    );
  });

  it("stringifies a non-Error rejection when logging the failed reply", async () => {
    const octokit = makeFakeOctokit();
    const logger = makeLogger();
    octokit.pulls.createReplyForReviewComment.mockRejectedValue(nonErrorRejection());
    const client = new RealGitHubClient("test-token", logger as never);
    (client as unknown as { octokit: FakeOctokit }).octokit = octokit;

    await client.replyToReviewComment("org/repo", 1, 500, "Thanks!");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "[object Object]" }),
      "Failed to reply to PR review comment, skipping",
    );
  });
});

describe("RealGitHubClient.submitPRReview", () => {
  it("submits a review with the given event", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReview.mockResolvedValue({ data: {} });
    const client = makeClient(octokit);

    await client.submitPRReview("org/repo", 1, "LGTM", "APPROVE");

    expect(octokit.pulls.createReview).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "LGTM",
      event: "APPROVE",
    });
  });

  it("falls back to a COMMENT review when requesting changes on your own PR", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReview
      .mockRejectedValueOnce(httpError(422, "Can not request changes on your own pull request"))
      .mockResolvedValueOnce({ data: {} });
    const client = makeClient(octokit);

    await client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES");

    expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(2, {
      owner: "org",
      repo: "repo",
      pull_number: 1,
      body: "Needs work",
      event: "COMMENT",
    });
  });

  it("throws a wrapped error when the own-PR message is matched but the event was already COMMENT", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReview.mockRejectedValue(
      httpError(422, "Can not request changes on your own pull request"),
    );
    const client = makeClient(octokit);

    await expect(client.submitPRReview("org/repo", 1, "Note", "COMMENT")).rejects.toThrow(
      'GitHub submitPRReview failed for "org/repo"',
    );
    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
  });

  it("throws a wrapped error for an unrelated failure message", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReview.mockRejectedValue(httpError(500, "Server error"));
    const client = makeClient(octokit);

    await expect(
      client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).rejects.toThrow('GitHub submitPRReview failed for "org/repo" {"prNumber":1,"event":"REQUEST_CHANGES"}: Server error');
  });

  it("stringifies a non-Error rejection when wrapping the error", async () => {
    const octokit = makeFakeOctokit();
    octokit.pulls.createReview.mockRejectedValue(nonErrorRejection());
    const client = makeClient(octokit);

    await expect(
      client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).rejects.toThrow(
      'GitHub submitPRReview failed for "org/repo" {"prNumber":1,"event":"REQUEST_CHANGES"}: [object Object]',
    );
  });
});

describe("RealGitHubClient constructor", () => {
  it("constructs without throwing given a token and logger", () => {
    expect(() => new RealGitHubClient("test-token", makeLogger() as never)).not.toThrow();
  });
});
