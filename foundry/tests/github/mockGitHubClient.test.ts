import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

/** Reads the private prComments array for assertions on exact body formatting. */
function getRecordedComments(
  client: MockGitHubClient,
): { prNumber: number; body: string }[] {
  return (client as unknown as { prComments: { prNumber: number; body: string }[] })
    .prComments;
}

describe("MockGitHubClient", () => {
  describe("verifyRepoAccess / getDefaultBranch", () => {
    it("resolves without throwing for any repo", async () => {
      const client = new MockGitHubClient();
      await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
    });

    it("always returns 'main' as the default branch", async () => {
      const client = new MockGitHubClient();
      await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
      await expect(client.getDefaultBranch("other/repo")).resolves.toBe("main");
    });
  });

  describe("createBranch / getCreatedBranches", () => {
    it("starts with no created branches", () => {
      const client = new MockGitHubClient();
      expect(client.getCreatedBranches()).toEqual([]);
    });

    it("tracks each created branch name in order", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/repo", "ai/issue-1");
      await client.createBranch("acme/repo", "ai/issue-2");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
    });

    it("returns a copy, so mutating the result does not affect internal state", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/repo", "ai/issue-1");

      const branches = client.getCreatedBranches();
      branches.push("not-real");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("creates a PR as a draft and returns an assigned PR number", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/repo",
        "ai/issue-1",
        "main",
        "Add feature",
        "PR body",
      );

      expect(prNumber).toBe(100);
      expect(client.getCreatedPRs().get(100)).toEqual({
        repo: "acme/repo",
        head: "ai/issue-1",
        title: "Add feature",
        draft: true,
      });
    });

    it("assigns sequentially increasing PR numbers across multiple PRs", async () => {
      const client = new MockGitHubClient();
      const first = await client.createDraftPR("acme/repo", "ai/1", "main", "First", "body");
      const second = await client.createDraftPR("acme/repo", "ai/2", "main", "Second", "body");

      expect(first).toBe(100);
      expect(second).toBe(101);
      expect(client.getCreatedPRs().size).toBe(2);
    });

    it("getCreatedPRs omits base/body and returns a snapshot copy", async () => {
      const client = new MockGitHubClient();
      await client.createDraftPR("acme/repo", "ai/issue-1", "main", "Add feature", "PR body");

      const prs = client.getCreatedPRs();
      const entry = prs.get(100);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty("base");
      expect(entry).not.toHaveProperty("body");

      prs.set(999, { repo: "fake", head: "fake", title: "fake", draft: false });
      expect(client.getCreatedPRs().has(999)).toBe(false);
    });
  });

  describe("commentOnPR", () => {
    it("records the comment body against the PR number unmodified", async () => {
      const client = new MockGitHubClient();
      await client.commentOnPR("acme/repo", 100, "Looks good to me");

      expect(getRecordedComments(client)).toEqual([{ prNumber: 100, body: "Looks good to me" }]);
    });
  });

  describe("getPRDiff", () => {
    it("returns a fixed sample unified diff", async () => {
      const client = new MockGitHubClient();
      const diff = await client.getPRDiff("acme/repo", 100);

      expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
      expect(diff).toContain("+export async function handleRequest");
    });
  });

  describe("markPRReady", () => {
    it("flips draft to false for an existing PR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/repo", "ai/1", "main", "Title", "body");
      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

      await client.markPRReady("acme/repo", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("is a no-op and does not throw when the PR number does not exist", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("acme/repo", 99999)).resolves.toBeUndefined();
      expect(client.getCreatedPRs().size).toBe(0);
    });

    it("is idempotent when called twice on the same PR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/repo", "ai/1", "main", "Title", "body");

      await client.markPRReady("acme/repo", prNumber);
      await client.markPRReady("acme/repo", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });
  });

  describe("listPRComments", () => {
    it("always resolves to an empty array", async () => {
      const client = new MockGitHubClient();
      await client.commentOnPR("acme/repo", 100, "some comment");

      await expect(client.listPRComments("acme/repo", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("embeds path and line in the recorded body as '[path:line] body'", async () => {
      const client = new MockGitHubClient();
      const commentId = await client.createPRReviewComment(
        "acme/repo",
        100,
        "Consider renaming this",
        "src/handler.ts",
        42,
      );

      expect(commentId).toBe(1000);
      expect(getRecordedComments(client)).toEqual([
        { prNumber: 100, body: "[src/handler.ts:42] Consider renaming this" },
      ]);
    });

    it("embeds only path (no colon) when line is omitted", async () => {
      const client = new MockGitHubClient();
      await client.createPRReviewComment("acme/repo", 100, "File-level note", "src/handler.ts");

      expect(getRecordedComments(client)).toEqual([
        { prNumber: 100, body: "[src/handler.ts] File-level note" },
      ]);
    });

    it("treats line 0 as falsy and omits the colon-suffixed line (edge case)", async () => {
      const client = new MockGitHubClient();
      await client.createPRReviewComment("acme/repo", 100, "Zero line", "src/handler.ts", 0);

      expect(getRecordedComments(client)).toEqual([
        { prNumber: 100, body: "[src/handler.ts] Zero line" },
      ]);
    });

    it("assigns sequentially increasing comment ids starting at 1000", async () => {
      const client = new MockGitHubClient();
      const first = await client.createPRReviewComment("acme/repo", 100, "a", "file.ts", 1);
      const second = await client.createPRReviewComment("acme/repo", 100, "b", "file.ts", 2);

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });
  });

  describe("replyToReviewComment", () => {
    it("records the reply body against the PR number, unformatted", async () => {
      const client = new MockGitHubClient();
      await client.replyToReviewComment("acme/repo", 100, 1000, "Good catch, fixed");

      expect(getRecordedComments(client)).toEqual([
        { prNumber: 100, body: "Good catch, fixed" },
      ]);
    });
  });

  describe("submitPRReview", () => {
    it.each(["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const)(
      "records the review body against the PR number regardless of event (%s)",
      async (event) => {
        const client = new MockGitHubClient();
        await client.submitPRReview("acme/repo", 100, "Review summary", event);

        expect(getRecordedComments(client)).toEqual([
          { prNumber: 100, body: "Review summary" },
        ]);
      },
    );
  });
});
