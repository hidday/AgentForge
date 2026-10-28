import { describe, it, expect, vi, beforeEach } from "vitest";

const octokitMock = {
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
  Octokit: vi.fn().mockImplementation(() => octokitMock),
}));

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function statusError(status: number, message = "error") {
  return Object.assign(new Error(message), { status });
}

describe("RealGitHubClient", () => {
  let client: InstanceType<
    typeof import("../../src/github/realGitHubClient.js").RealGitHubClient
  >;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { RealGitHubClient } = await import("../../src/github/realGitHubClient.js");
    client = new RealGitHubClient("gh-token", noopLogger);
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    });

    it("throws a descriptive error when the repo is inaccessible", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("404"));
      await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
        /cannot access repo "org\/repo"/,
      );
    });

    it("throws on a malformed repo string", async () => {
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        /Invalid repo format/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      expect(await client.getDefaultBranch("org/repo")).toBe("main");
    });

    it("wraps errors", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("down"));
      await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
        /GitHub getDefaultBranch failed for "org\/repo"/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch's HEAD sha", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokitMock.git.createRef.mockResolvedValue({});

      await client.createBranch("org/repo", "feature/x");

      expect(octokitMock.git.createRef).toHaveBeenCalledWith({
        owner: "org",
        repo: "repo",
        ref: "refs/heads/feature/x",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokitMock.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokitMock.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokitMock.git.createRef.mockRejectedValue(statusError(422));

      await expect(client.createBranch("org/repo", "feature/x")).resolves.toBeUndefined();
    });

    it("wraps other errors", async () => {
      octokitMock.repos.get.mockRejectedValue(new Error("down"));
      await expect(client.createBranch("org/repo", "feature/x")).rejects.toThrow(
        /createBranch failed/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokitMock.pulls.create.mockResolvedValue({ data: { number: 42 } });
      const result = await client.createDraftPR("org/repo", "feature/x", "main", "title", "body");
      expect(result).toBe(42);
      expect(octokitMock.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ draft: true, head: "feature/x", base: "main" }),
      );
    });

    it("looks up and returns an existing open PR on a non-field 422", async () => {
      octokitMock.pulls.create.mockRejectedValue(statusError(422, "A pull request already exists"));
      octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 7 }] });

      const result = await client.createDraftPR("org/repo", "feature/x", "main", "title", "body");

      expect(result).toBe(7);
    });

    it("throws when a 422 is a field-validation error (invalid base branch)", async () => {
      octokitMock.pulls.create.mockRejectedValue(
        statusError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("org/repo", "feature/x", "nonexistent", "title", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("throws when a 422 occurs but no existing open PR is found", async () => {
      octokitMock.pulls.create.mockRejectedValue(statusError(422, "duplicate"));
      octokitMock.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "title", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      octokitMock.pulls.create.mockRejectedValue(new Error("rate limited"));
      await expect(
        client.createDraftPR("org/repo", "feature/x", "main", "title", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });
  });

  describe("commentOnPR", () => {
    it("posts a comment", async () => {
      octokitMock.issues.createComment.mockResolvedValue({});
      await expect(client.commentOnPR("org/repo", 1, "hello")).resolves.toBeUndefined();
    });

    it("wraps errors", async () => {
      octokitMock.issues.createComment.mockRejectedValue(new Error("boom"));
      await expect(client.commentOnPR("org/repo", 1, "hello")).rejects.toThrow(
        /commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the raw diff text", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      expect(await client.getPRDiff("org/repo", 1)).toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.getPRDiff("org/repo", 1)).rejects.toThrow(/getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: false } });
      await client.markPRReady("org/repo", 1);
      expect(octokitMock.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "PR_id" } });
      octokitMock.graphql.mockResolvedValue({});

      await client.markPRReady("org/repo", 1);

      expect(octokitMock.graphql).toHaveBeenCalledWith(
        expect.stringContaining("markPullRequestReadyForReview"),
        { prId: "PR_id" },
      );
    });

    it("wraps errors", async () => {
      octokitMock.pulls.get.mockRejectedValue(new Error("boom"));
      await expect(client.markPRReady("org/repo", 1)).rejects.toThrow(/markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments to the PRComment shape, defaulting missing author/body", async () => {
      octokitMock.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("org/repo", 1);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hi", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokitMock.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("org/repo", 1)).rejects.toThrow(/listPRComments failed/);
    });
  });

  describe("createPRReviewComment", () => {
    it("creates a line-level review comment", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 55 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);

      expect(id).toBe(55);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ line: 10, side: "RIGHT", commit_id: "sha1" }),
      );
    });

    it("creates a file-level comment when no line is given", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockResolvedValue({ data: { id: 56 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts");

      expect(id).toBe(56);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file" }),
      );
    });

    it("falls back to a file-level comment when the line is not in the diff (422)", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment
        .mockRejectedValueOnce(statusError(422))
        .mockResolvedValueOnce({ data: { id: 57 } });

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 999);

      expect(id).toBe(57);
      expect(octokitMock.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      const secondCall = octokitMock.pulls.createReviewComment.mock.calls[1][0];
      expect(secondCall.body).toContain("(line 999)");
      expect(secondCall.subject_type).toBe("file");
    });

    it("returns 0 and swallows a top-level 422 (file not in diff, no line given)", async () => {
      octokitMock.pulls.get.mockRejectedValue(statusError(422));

      const id = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts");

      expect(id).toBe(0);
    });

    it("rethrows a non-422 error from the line-comment attempt", async () => {
      octokitMock.pulls.get.mockResolvedValue({ data: { head: { sha: "sha1" } } });
      octokitMock.pulls.createReviewComment.mockRejectedValue(new Error("boom"));

      await expect(
        client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockResolvedValue({});
      await expect(
        client.replyToReviewComment("org/repo", 1, 55, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokitMock.pulls.createReplyForReviewComment.mockRejectedValue(new Error("boom"));

      await expect(
        client.replyToReviewComment("org/repo", 1, 55, "thanks"),
      ).resolves.toBeUndefined();
      expect(noopLogger.warn).toHaveBeenCalled();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review", async () => {
      octokitMock.pulls.createReview.mockResolvedValue({});
      await expect(
        client.submitPRReview("org/repo", 1, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();
    });

    it("falls back to COMMENT when requesting changes on your own PR", async () => {
      octokitMock.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("org/repo", 1, "needs work", "REQUEST_CHANGES");

      expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokitMock.pulls.createReview.mock.calls[1][0]).toMatchObject({ event: "COMMENT" });
    });

    it("wraps other errors", async () => {
      octokitMock.pulls.createReview.mockRejectedValue(new Error("boom"));
      await expect(
        client.submitPRReview("org/repo", 1, "lgtm", "APPROVE"),
      ).rejects.toThrow(/submitPRReview failed/);
    });
  });
});
