import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  describe("verifyRepoAccess", () => {
    it("resolves without throwing for any repo name", async () => {
      const client = new MockGitHubClient();
      await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
    });
  });

  describe("getDefaultBranch", () => {
    it("always returns 'main'", async () => {
      const client = new MockGitHubClient();
      await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
    });
  });

  describe("createBranch", () => {
    it("records the created branch name and exposes it via getCreatedBranches", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });

    it("accumulates multiple created branches in order", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");
      await client.createBranch("acme/widgets", "ai/issue-2");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
    });

    it("returns a defensive copy so mutating the result does not affect internal state", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "ai/issue-1");

      const branches = client.getCreatedBranches();
      branches.push("ai/injected");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("creates a PR starting at number 100 and marks it as a draft", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "ai/issue-1",
        "main",
        "My title",
        "My body",
      );

      expect(prNumber).toBe(100);
      const prs = client.getCreatedPRs();
      expect(prs.get(100)).toEqual({
        repo: "acme/widgets",
        head: "ai/issue-1",
        title: "My title",
        draft: true,
      });
    });

    it("increments the PR number on each call", async () => {
      const client = new MockGitHubClient();
      const first = await client.createDraftPR("acme/widgets", "a", "main", "t1", "b1");
      const second = await client.createDraftPR("acme/widgets", "b", "main", "t2", "b2");

      expect(first).toBe(100);
      expect(second).toBe(101);
      expect(client.getCreatedPRs().size).toBe(2);
    });
  });

  describe("commentOnPR", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(client.commentOnPR("acme/widgets", 100, "a comment")).resolves.toBeUndefined();
    });
  });

  describe("getPRDiff", () => {
    it("returns a non-empty unified diff string", async () => {
      const client = new MockGitHubClient();
      const diff = await client.getPRDiff("acme/widgets", 100);

      expect(diff).toContain("diff --git");
      expect(diff).toContain("+export async function handleRequest");
    });
  });

  describe("markPRReady", () => {
    it("flips draft to false for a PR created via createDraftPR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "t", "b");

      await client.markPRReady("acme/widgets", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("does nothing (no throw) when the PR number is unknown", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("acme/widgets", 999)).resolves.toBeUndefined();
    });
  });

  describe("listPRComments", () => {
    it("always returns an empty array", async () => {
      const client = new MockGitHubClient();
      await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("returns an incrementing comment id starting at 1000", async () => {
      const client = new MockGitHubClient();
      const first = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "looks good",
        "src/a.ts",
        12,
      );
      const second = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "another",
        "src/b.ts",
      );

      expect(first).toBe(1000);
      expect(second).toBe(1001);
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
        client.submitPRReview("acme/widgets", 100, "a note", "COMMENT"),
      ).resolves.toBeUndefined();
    });
  });
});
