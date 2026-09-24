import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  describe("verifyRepoAccess", () => {
    it("resolves without throwing for any repo", async () => {
      const client = new MockGitHubClient();
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
    });
  });

  describe("getDefaultBranch", () => {
    it("always resolves to 'main'", async () => {
      const client = new MockGitHubClient();
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
    });
  });

  describe("createBranch", () => {
    it("records the created branch name and makes it retrievable", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });

    it("accumulates branches across multiple calls, preserving order", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");
      await client.createBranch("acme/widgets", "ai/issue-2");
      await client.createBranch("acme/other", "ai/issue-3");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2", "ai/issue-3"]);
    });

    it("getCreatedBranches returns a copy, not a live reference", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");

      const branches = client.getCreatedBranches();
      branches.push("mutated-externally");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });
  });

  describe("createDraftPR", () => {
    it("returns sequential PR numbers starting at 100", async () => {
      const client = new MockGitHubClient();
      const first = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body 1",
      );
      const second = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-2",
        "main",
        "Fix another bug",
        "Body 2",
      );

      expect(first).toBe(100);
      expect(second).toBe(101);
    });

    it("stores the PR as a draft with the given fields, retrievable via getCreatedPRs", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body text",
      );

      const prs = client.getCreatedPRs();
      expect(prs.get(prNumber)).toEqual({
        repo: "acme/widgets",
        head: "ai/issue-1",
        title: "Fix bug",
        draft: true,
      });
    });

    it("keeps independently numbered PRs in the map across multiple creations", async () => {
      const client = new MockGitHubClient();
      const first = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "PR A", "");
      const second = await client.createDraftPR("acme/widgets", "ai/issue-2", "main", "PR B", "");

      const prs = client.getCreatedPRs();
      expect(prs.size).toBe(2);
      expect(prs.get(first)?.title).toBe("PR A");
      expect(prs.get(second)?.title).toBe("PR B");
    });

    it("getCreatedPRs returns a copy, not a live reference", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body",
      );

      const prs = client.getCreatedPRs();
      prs.delete(prNumber);

      expect(client.getCreatedPRs().has(prNumber)).toBe(true);
    });
  });

  describe("markPRReady", () => {
    it("flips draft to false for an existing PR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "Fix bug",
        "Body",
      );

      await client.markPRReady("acme/widgets", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("is a no-op when the PR number does not exist", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
      expect(client.getCreatedPRs().size).toBe(0);
    });
  });

  describe("commentOnPR", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.commentOnPR("acme/widgets", 100, "Looks good"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getPRDiff", () => {
    it("returns a non-empty unified diff string", async () => {
      const client = new MockGitHubClient();
      const diff = await client.getPRDiff("acme/widgets", 100);

      expect(diff).toContain("diff --git");
      expect(diff).toContain("handleRequest");
    });
  });

  describe("listPRComments", () => {
    it("resolves to an empty array", async () => {
      const client = new MockGitHubClient();
      await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("returns sequential comment ids starting at 1000", async () => {
      const client = new MockGitHubClient();
      const first = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "Consider renaming this",
        "src/foo.ts",
        12,
      );
      const second = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "Another note",
        "src/bar.ts",
        3,
      );

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });

    it("does not affect PR draft state when adding a review comment", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "T", "");
      await client.createPRReviewComment(
        "acme/widgets",
        prNumber,
        "Consider renaming this",
        "src/foo.ts",
        12,
      );

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);
    });

    it("omits the line suffix when no line is given (file-level comment)", async () => {
      const client = new MockGitHubClient();
      const commentId = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "File-level note",
        "src/foo.ts",
      );

      expect(commentId).toBe(1000);
    });

    it("continues incrementing comment ids across many calls", async () => {
      const client = new MockGitHubClient();
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          await client.createPRReviewComment("acme/widgets", 100, `note ${String(i)}`, "f.ts", i),
        );
      }

      expect(ids).toEqual([1000, 1001, 1002, 1003, 1004]);
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.replyToReviewComment("acme/widgets", 100, 1000, "Thanks, fixed"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("resolves without throwing for APPROVE", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.submitPRReview("acme/widgets", 100, "LGTM", "APPROVE"),
      ).resolves.toBeUndefined();
    });

    it("resolves without throwing for REQUEST_CHANGES", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.submitPRReview("acme/widgets", 100, "Needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();
    });

    it("resolves without throwing for COMMENT", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.submitPRReview("acme/widgets", 100, "Just a note", "COMMENT"),
      ).resolves.toBeUndefined();
    });
  });

  describe("stateful sequences", () => {
    it("supports a full branch -> draft PR -> ready workflow with correct bookkeeping", async () => {
      const client = new MockGitHubClient();

      await client.createBranch("acme/widgets", "ai/issue-42");
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-42",
        "main",
        "Implement feature",
        "Implements the feature described in issue-42",
      );
      await client.commentOnPR("acme/widgets", prNumber, "Starting review");
      const reviewCommentId = await client.createPRReviewComment(
        "acme/widgets",
        prNumber,
        "Nit: rename variable",
        "src/feature.ts",
        20,
      );
      await client.replyToReviewComment("acme/widgets", prNumber, reviewCommentId, "Done");
      await client.markPRReady("acme/widgets", prNumber);
      await client.submitPRReview("acme/widgets", prNumber, "LGTM", "APPROVE");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-42"]);
      expect(prNumber).toBe(100);
      expect(reviewCommentId).toBe(1000);
      expect(client.getCreatedPRs().get(prNumber)).toEqual({
        repo: "acme/widgets",
        head: "ai/issue-42",
        title: "Implement feature",
        draft: false,
      });
    });
  });
});
