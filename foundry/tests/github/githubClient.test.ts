import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess without throwing regardless of input", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("resolves getDefaultBranch with 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  describe("createBranch / getCreatedBranches", () => {
    it("records created branches in order", async () => {
      const client = new MockGitHubClient();

      await client.createBranch("acme/widgets", "feature/a");
      await client.createBranch("acme/widgets", "feature/b");

      expect(client.getCreatedBranches()).toEqual(["feature/a", "feature/b"]);
    });

    it("returns a defensive copy that cannot mutate internal state", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("acme/widgets", "feature/a");

      const branches = client.getCreatedBranches();
      branches.push("feature/injected");

      expect(client.getCreatedBranches()).toEqual(["feature/a"]);
    });

    it("returns an empty array when no branches have been created", () => {
      const client = new MockGitHubClient();
      expect(client.getCreatedBranches()).toEqual([]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("assigns incrementing PR numbers starting at 100", async () => {
      const client = new MockGitHubClient();

      const first = await client.createDraftPR("acme/widgets", "feature/a", "main", "T1", "B1");
      const second = await client.createDraftPR("acme/widgets", "feature/b", "main", "T2", "B2");

      expect(first).toBe(100);
      expect(second).toBe(101);
    });

    it("stores PR details as drafts, accessible via getCreatedPRs", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR(
        "acme/widgets",
        "feature/a",
        "main",
        "My title",
        "My body",
      );

      const prs = client.getCreatedPRs();

      expect(prs.get(prNumber)).toEqual({
        repo: "acme/widgets",
        head: "feature/a",
        title: "My title",
        draft: true,
      });
    });

    it("returns a fresh map each call so mutating it does not affect state", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/widgets", "feature/a", "main", "T", "B");

      const prs = client.getCreatedPRs();
      prs.delete(prNumber);

      expect(client.getCreatedPRs().has(prNumber)).toBe(true);
    });
  });

  describe("commentOnPR", () => {
    it("resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(client.commentOnPR("acme/widgets", 100, "hello")).resolves.toBeUndefined();
    });
  });

  describe("getPRDiff", () => {
    it("returns a fixed sample diff containing a diff header", async () => {
      const client = new MockGitHubClient();
      const diff = await client.getPRDiff("acme/widgets", 100);

      expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
      expect(diff).toContain("export async function handleRequest");
    });

    it("returns the same diff text on every call", async () => {
      const client = new MockGitHubClient();
      const first = await client.getPRDiff("acme/widgets", 1);
      const second = await client.getPRDiff("other/repo", 2);

      expect(first).toBe(second);
    });
  });

  describe("markPRReady", () => {
    it("flips a created PR's draft flag to false", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("acme/widgets", "feature/a", "main", "T", "B");

      await client.markPRReady("acme/widgets", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("does nothing (no throw) when the PR number is unknown", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("acme/widgets", 999)).resolves.toBeUndefined();
      expect(client.getCreatedPRs().size).toBe(0);
    });
  });

  describe("listPRComments", () => {
    it("resolves to an empty array", async () => {
      const client = new MockGitHubClient();
      await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
    });
  });

  describe("createPRReviewComment", () => {
    it("assigns incrementing comment ids starting at 1000", async () => {
      const client = new MockGitHubClient();

      const first = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "body",
        "src/foo.ts",
        10,
      );
      const second = await client.createPRReviewComment(
        "acme/widgets",
        100,
        "body2",
        "src/bar.ts",
      );

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });

    it("resolves without throwing whether or not a line is given", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.createPRReviewComment("acme/widgets", 100, "body", "src/foo.ts", 42),
      ).resolves.toBe(1000);
      await expect(
        client.createPRReviewComment("acme/widgets", 100, "body", "src/foo.ts"),
      ).resolves.toBe(1001);
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
    it("resolves without throwing for every event type", async () => {
      const client = new MockGitHubClient();
      await expect(
        client.submitPRReview("acme/widgets", 100, "lgtm", "APPROVE"),
      ).resolves.toBeUndefined();
      await expect(
        client.submitPRReview("acme/widgets", 100, "needs work", "REQUEST_CHANGES"),
      ).resolves.toBeUndefined();
      await expect(
        client.submitPRReview("acme/widgets", 100, "fyi", "COMMENT"),
      ).resolves.toBeUndefined();
    });
  });
});
