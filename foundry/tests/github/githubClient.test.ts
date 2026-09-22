import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  describe("verifyRepoAccess / getDefaultBranch", () => {
    it("resolves without error and returns 'main' as the default branch", async () => {
      const client = new MockGitHubClient();
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
    });
  });

  describe("createBranch / getCreatedBranches", () => {
    it("records created branch names in order", async () => {
      const client = new MockGitHubClient();

      await client.createBranch("acme/widgets", "feature/a");
      await client.createBranch("acme/widgets", "feature/b");

      expect(client.getCreatedBranches()).toEqual(["feature/a", "feature/b"]);
    });

    it("returns a copy, not a live reference", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "feature/a");

      const snapshot = client.getCreatedBranches();
      snapshot.push("injected");

      expect(client.getCreatedBranches()).toEqual(["feature/a"]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("assigns incrementing PR numbers starting at 100 and marks them draft", async () => {
      const client = new MockGitHubClient();

      const pr1 = await client.createDraftPR("acme/widgets", "head1", "main", "Title 1", "Body 1");
      const pr2 = await client.createDraftPR("acme/widgets", "head2", "main", "Title 2", "Body 2");

      expect(pr1).toBe(100);
      expect(pr2).toBe(101);
      expect(client.getCreatedPRs()).toEqual(
        new Map([
          [100, { repo: "acme/widgets", head: "head1", title: "Title 1", draft: true }],
          [101, { repo: "acme/widgets", head: "head2", title: "Title 2", draft: true }],
        ]),
      );
    });
  });

  describe("markPRReady", () => {
    it("flips draft to false for an existing PR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/widgets", "head", "main", "Title", "Body");

      await client.markPRReady("acme/widgets", prNumber);

      const pr = client.getCreatedPRs().get(prNumber);
      expect(pr?.draft).toBe(false);
    });

    it("is a no-op for a PR number that doesn't exist", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("acme/widgets", 999)).resolves.toBeUndefined();
    });
  });

  describe("commentOnPR", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(client.commentOnPR("acme/widgets", 100, "hello")).resolves.toBeUndefined();
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
    it("returns an empty array", async () => {
      const client = new MockGitHubClient();
      await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("assigns incrementing comment ids starting at 1000", async () => {
      const client = new MockGitHubClient();

      const id1 = await client.createPRReviewComment("acme/widgets", 100, "body1", "src/a.ts", 5);
      const id2 = await client.createPRReviewComment("acme/widgets", 100, "body2", "src/b.ts");

      expect(id1).toBe(1000);
      expect(id2).toBe(1001);
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.replyToReviewComment("acme/widgets", 100, 1000, "thanks"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("resolves without throwing for each review event type", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.submitPRReview("acme/widgets", 100, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();
      await expect(
        client.submitPRReview("acme/widgets", 100, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();
      await expect(
        client.submitPRReview("acme/widgets", 100, "note", "COMMENT"),
      ).resolves.toBeUndefined();
    });
  });
});
