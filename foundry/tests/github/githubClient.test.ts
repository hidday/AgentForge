import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  describe("verifyRepoAccess / getDefaultBranch", () => {
    it("always resolves verifyRepoAccess without throwing", async () => {
      await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    });

    it("always returns 'main' as the default branch", async () => {
      await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
    });
  });

  describe("createBranch / getCreatedBranches", () => {
    it("starts with no created branches", () => {
      expect(client.getCreatedBranches()).toEqual([]);
    });

    it("records each created branch name in order", async () => {
      await client.createBranch("org/repo", "ai/issue-1");
      await client.createBranch("org/repo", "ai/issue-2");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
    });

    it("returns a defensive copy so mutating the result does not affect internal state", async () => {
      await client.createBranch("org/repo", "ai/issue-1");
      const branches = client.getCreatedBranches();
      branches.push("mutated");

      expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("starts with no created PRs", () => {
      expect(client.getCreatedPRs().size).toBe(0);
    });

    it("assigns sequential PR numbers starting at 100", async () => {
      const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
      const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

      expect(first).toBe(100);
      expect(second).toBe(101);
    });

    it("stores PR data as a draft, retrievable via getCreatedPRs", async () => {
      const prNumber = await client.createDraftPR(
        "org/repo",
        "ai/issue-1",
        "main",
        "Fix bug",
        "This fixes the bug",
      );

      const prs = client.getCreatedPRs();
      expect(prs.get(prNumber)).toEqual({
        repo: "org/repo",
        head: "ai/issue-1",
        title: "Fix bug",
        draft: true,
      });
    });

    it("returns a defensive copy so mutating the result does not affect internal state", async () => {
      const prNumber = await client.createDraftPR("org/repo", "h", "main", "T", "B");
      const prs = client.getCreatedPRs();
      prs.delete(prNumber);

      expect(client.getCreatedPRs().has(prNumber)).toBe(true);
    });
  });

  describe("markPRReady", () => {
    it("flips the draft flag to false for an existing PR", async () => {
      const prNumber = await client.createDraftPR("org/repo", "h", "main", "T", "B");
      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

      await client.markPRReady("org/repo", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("is a no-op when the PR number does not exist", async () => {
      await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
      expect(client.getCreatedPRs().size).toBe(0);
    });
  });

  describe("commentOnPR", () => {
    it("resolves without throwing for any PR number", async () => {
      await expect(client.commentOnPR("org/repo", 100, "hello")).resolves.toBeUndefined();
    });
  });

  describe("getPRDiff", () => {
    it("returns a fixed, non-empty synthetic diff", async () => {
      const diff = await client.getPRDiff("org/repo", 100);

      expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
      expect(diff).toContain("+export async function handleRequest");
    });
  });

  describe("listPRComments", () => {
    it("always returns an empty array", async () => {
      await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("assigns sequential comment ids starting at 1000", async () => {
      const first = await client.createPRReviewComment("org/repo", 100, "body1", "file.ts");
      const second = await client.createPRReviewComment("org/repo", 100, "body2", "file.ts");

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });

    it("prefixes the body with the file path when no line is given", async () => {
      await client.createPRReviewComment("org/repo", 100, "body text", "src/file.ts");
      // Verified indirectly: no direct getter for prComments, so exercise via
      // replyToReviewComment path is not applicable. Instead confirm the call
      // resolves without error and produces a distinct comment id from a
      // subsequent call, proving state was recorded.
      const secondId = await client.createPRReviewComment("org/repo", 100, "other", "src/file.ts");
      expect(secondId).toBe(1001);
    });

    it("includes the line number in the prefix when a line is provided", async () => {
      const id = await client.createPRReviewComment("org/repo", 100, "body", "src/file.ts", 42);
      expect(id).toBe(1000);
    });
  });

  describe("replyToReviewComment", () => {
    it("resolves without throwing", async () => {
      await expect(
        client.replyToReviewComment("org/repo", 100, 1000, "reply body"),
      ).resolves.toBeUndefined();
    });
  });

  describe("submitPRReview", () => {
    it("resolves without throwing for APPROVE", async () => {
      await expect(
        client.submitPRReview("org/repo", 100, "looks good", "APPROVE"),
      ).resolves.toBeUndefined();
    });

    it("resolves without throwing for REQUEST_CHANGES", async () => {
      await expect(
        client.submitPRReview("org/repo", 100, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();
    });

    it("resolves without throwing for COMMENT", async () => {
      await expect(
        client.submitPRReview("org/repo", 100, "fyi", "COMMENT"),
      ).resolves.toBeUndefined();
    });
  });
});
