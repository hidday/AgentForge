import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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

function withFakeOctokit(client: RealGitHubClient, fake: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = fake;
}

function httpError(status: number, message = "boom"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("RealGitHubClient", () => {
  let client: RealGitHubClient;
  let octokit: FakeOctokit;

  beforeEach(() => {
    client = new RealGitHubClient("token", makeLogger() as never);
    octokit = makeFakeOctokit();
    withFakeOctokit(client, octokit);
  });

  describe("repo format validation", () => {
    it("throws for a repo string without a slash", async () => {
      await expect(client.verifyRepoAccess("not-a-repo")).rejects.toThrow(
        /Invalid repo format "not-a-repo"/,
      );
    });
  });

  describe("verifyRepoAccess", () => {
    it("resolves when the repo is accessible", async () => {
      octokit.repos.get.mockResolvedValue({ data: {} });
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
      expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "acme", repo: "widgets" });
    });

    it("wraps the error with a helpful message when access fails", async () => {
      octokit.repos.get.mockRejectedValue(new Error("Not Found"));
      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*Not Found/,
      );
    });

    it("stringifies a non-Error rejection", async () => {
      octokit.repos.get.mockRejectedValue("rate limited");
      await expect(client.verifyRepoAccess("acme/widgets")).rejects.toThrow(
        /cannot access repo "acme\/widgets".*rate limited/,
      );
    });
  });

  describe("getDefaultBranch", () => {
    it("returns the default branch name", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "develop" } });
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("develop");
    });

    it("wraps errors", async () => {
      octokit.repos.get.mockRejectedValue(new Error("down"));
      await expect(client.getDefaultBranch("acme/widgets")).rejects.toThrow(
        /getDefaultBranch failed for "acme\/widgets"/,
      );
    });
  });

  describe("createBranch", () => {
    it("creates a branch off the default branch head sha", async () => {
      octokit.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
      octokit.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      octokit.git.createRef.mockResolvedValue({});

      await client.createBranch("acme/widgets", "ai/issue-1");

      expect(octokit.git.getRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "heads/main",
      });
      expect(octokit.git.createRef).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        ref: "refs/heads/ai/issue-1",
        sha: "abc123",
      });
    });

    it("treats a 422 (branch already exists) as success", async () => {
      octokit.repos.get.mockRejectedValue(httpError(422));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).resolves.toBeUndefined();
    });

    it("wraps non-422 errors", async () => {
      octokit.repos.get.mockRejectedValue(httpError(500, "server error"));

      await expect(client.createBranch("acme/widgets", "ai/issue-1")).rejects.toThrow(
        /createBranch failed for "acme\/widgets".*server error/,
      );
    });
  });

  describe("createDraftPR", () => {
    it("creates a draft PR and returns its number", async () => {
      octokit.pulls.create.mockResolvedValue({ data: { number: 7 } });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "body",
      );

      expect(prNumber).toBe(7);
      expect(octokit.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ draft: true, head: "ai/issue-1", base: "main" }),
      );
    });

    it("throws when a 422 indicates an actual field validation error", async () => {
      octokit.pulls.create.mockRejectedValue(
        httpError(422, '{"code":"invalid","field":"base"}'),
      );

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "bad-base", "Fix bug", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("looks up and returns an existing open PR when a 422 means the PR already exists", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "body",
      );

      expect(prNumber).toBe(55);
    });

    it("throws when a 422 means the PR exists but none is found via list", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(422, "already exists"));
      octokit.pulls.list.mockResolvedValue({ data: [] });

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("wraps non-422 errors", async () => {
      octokit.pulls.create.mockRejectedValue(httpError(500));

      await expect(
        client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "body"),
      ).rejects.toThrow(/createDraftPR failed/);
    });

    it("treats a non-Error 422 rejection as a non-field-validation error and looks up the existing PR", async () => {
      const err = { status: 422 } as unknown as Error;
      octokit.pulls.create.mockRejectedValue(err);
      octokit.pulls.list.mockResolvedValue({ data: [{ number: 55 }] });

      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "body",
      );

      expect(prNumber).toBe(55);
    });
  });

  describe("commentOnPR", () => {
    it("posts an issue comment", async () => {
      octokit.issues.createComment.mockResolvedValue({});
      await expect(client.commentOnPR("acme/widgets", 7, "hi")).resolves.toBeUndefined();
      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 7,
        body: "hi",
      });
    });

    it("wraps errors", async () => {
      octokit.issues.createComment.mockRejectedValue(new Error("rate limited"));
      await expect(client.commentOnPR("acme/widgets", 7, "hi")).rejects.toThrow(
        /commentOnPR failed/,
      );
    });
  });

  describe("getPRDiff", () => {
    it("returns the diff text", async () => {
      octokit.pulls.get.mockResolvedValue({ data: "diff --git a b" });
      await expect(client.getPRDiff("acme/widgets", 7)).resolves.toBe("diff --git a b");
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("not found"));
      await expect(client.getPRDiff("acme/widgets", 7)).rejects.toThrow(/getPRDiff failed/);
    });
  });

  describe("markPRReady", () => {
    it("does nothing when the PR is already not a draft", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: false } });
      await client.markPRReady("acme/widgets", 7);
      expect(octokit.graphql).not.toHaveBeenCalled();
    });

    it("marks a draft PR ready via the GraphQL mutation", async () => {
      octokit.pulls.get.mockResolvedValue({ data: { draft: true, node_id: "node-1" } });
      octokit.graphql.mockResolvedValue({});

      await client.markPRReady("acme/widgets", 7);

      expect(octokit.graphql).toHaveBeenCalledWith(expect.any(String), { prId: "node-1" });
    });

    it("wraps errors", async () => {
      octokit.pulls.get.mockRejectedValue(new Error("gone"));
      await expect(client.markPRReady("acme/widgets", 7)).rejects.toThrow(/markPRReady failed/);
    });
  });

  describe("listPRComments", () => {
    it("maps comments, defaulting missing author/body", async () => {
      octokit.issues.listComments.mockResolvedValue({
        data: [
          { id: 1, user: { login: "alice" }, body: "hello", created_at: "2026-01-01T00:00:00Z" },
          { id: 2, user: null, body: null, created_at: "2026-01-02T00:00:00Z" },
        ],
      });

      const comments = await client.listPRComments("acme/widgets", 7);

      expect(comments).toEqual([
        { id: "1", author: "alice", body: "hello", createdAt: "2026-01-01T00:00:00Z" },
        { id: "2", author: "unknown", body: "", createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    it("wraps errors", async () => {
      octokit.issues.listComments.mockRejectedValue(new Error("boom"));
      await expect(client.listPRComments("acme/widgets", 7)).rejects.toThrow(
        /listPRComments failed/,
      );
    });
  });

  describe("createPRReviewComment", () => {
    beforeEach(() => {
      octokit.pulls.get.mockResolvedValue({ data: { head: { sha: "sha-1" } } });
    });

    it("creates a line-level review comment when line is provided", async () => {
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 1001 } });

      const id = await client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts", 10);

      expect(id).toBe(1001);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ line: 10, side: "RIGHT", path: "src/a.ts" }),
      );
    });

    it("creates a file-level comment directly when no line is provided", async () => {
      octokit.pulls.createReviewComment.mockResolvedValue({ data: { id: 1002 } });

      const id = await client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts");

      expect(id).toBe(1002);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({ subject_type: "file" }),
      );
    });

    it("falls back to a file-level comment when the line is not part of the diff (422)", async () => {
      octokit.pulls.createReviewComment
        .mockRejectedValueOnce(httpError(422))
        .mockResolvedValueOnce({ data: { id: 1003 } });

      const id = await client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts", 10);

      expect(id).toBe(1003);
      expect(octokit.pulls.createReviewComment).toHaveBeenCalledTimes(2);
      const fallbackCall = octokit.pulls.createReviewComment.mock.calls[1][0] as {
        subject_type: string;
        body: string;
      };
      expect(fallbackCall.subject_type).toBe("file");
      expect(fallbackCall.body).toContain("(line 10)");
    });

    it("rethrows a non-422 line-level error, which the outer handler then wraps", async () => {
      octokit.pulls.createReviewComment.mockRejectedValueOnce(httpError(500, "server error"));

      await expect(
        client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts", 10),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });

    it("returns 0 when the overall request 422s outside the line-fallback path (e.g. pulls.get fails)", async () => {
      octokit.pulls.get.mockRejectedValueOnce(httpError(422));

      const id = await client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts");

      expect(id).toBe(0);
    });

    it("wraps a non-422 error from pulls.get", async () => {
      octokit.pulls.get.mockRejectedValueOnce(httpError(500));

      await expect(
        client.createPRReviewComment("acme/widgets", 7, "msg", "src/a.ts"),
      ).rejects.toThrow(/createPRReviewComment failed/);
    });
  });

  describe("replyToReviewComment", () => {
    it("posts a reply", async () => {
      octokit.pulls.createReplyForReviewComment.mockResolvedValue({});
      await expect(
        client.replyToReviewComment("acme/widgets", 7, 1001, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows errors and logs a warning instead of throwing", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue(new Error("comment deleted"));

      await expect(
        client.replyToReviewComment("acme/widgets", 7, 1001, "thanks"),
      ).resolves.toBeUndefined();
    });

    it("swallows a non-Error rejection as well", async () => {
      octokit.pulls.createReplyForReviewComment.mockRejectedValue("comment deleted");

      await expect(
        client.replyToReviewComment("acme/widgets", 7, 1001, "thanks"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("submits a review with the given event", async () => {
      octokit.pulls.createReview.mockResolvedValue({});

      await client.submitPRReview("acme/widgets", 7, "LGTM", "APPROVE");

      expect(octokit.pulls.createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "APPROVE", body: "LGTM" }),
      );
    });

    it("falls back to COMMENT when GitHub rejects requesting changes on your own PR", async () => {
      octokit.pulls.createReview
        .mockRejectedValueOnce(new Error("Can not request changes on your own pull request"))
        .mockResolvedValueOnce({});

      await client.submitPRReview("acme/widgets", 7, "Needs work", "REQUEST_CHANGES");

      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(2);
      expect(octokit.pulls.createReview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ event: "COMMENT" }),
      );
    });

    it("wraps other errors without falling back", async () => {
      octokit.pulls.createReview.mockRejectedValue(new Error("rate limited"));

      await expect(
        client.submitPRReview("acme/widgets", 7, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps a non-Error rejection without attempting a fallback", async () => {
      octokit.pulls.createReview.mockRejectedValue("rate limited");

      await expect(
        client.submitPRReview("acme/widgets", 7, "Needs work", "REQUEST_CHANGES"),
      ).rejects.toThrow(/submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });

    it("wraps errors for COMMENT events without attempting a fallback", async () => {
      octokit.pulls.createReview.mockRejectedValue(
        new Error("Can not request changes on your own pull request"),
      );

      await expect(
        client.submitPRReview("acme/widgets", 7, "Just a note", "COMMENT"),
      ).rejects.toThrow(/submitPRReview failed/);
      expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
    });
  });
});
