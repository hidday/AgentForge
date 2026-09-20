import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves regardless of the repo argument", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  describe("createBranch / getCreatedBranches", () => {
    it("records created branch names in order", async () => {
      const client = new MockGitHubClient();

      await client.createBranch("owner/repo", "ai/feature-1");
      await client.createBranch("owner/repo", "ai/feature-2");

      expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
    });

    it("returns a copy so mutating the result does not affect internal state", async () => {
      const client = new MockGitHubClient();
      await client.createBranch("owner/repo", "ai/feature-1");

      const branches = client.getCreatedBranches();
      branches.push("injected");

      expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
    });
  });

  describe("createDraftPR / getCreatedPRs / markPRReady", () => {
    it("creates PRs with incrementing numbers starting at 100, marked as draft", async () => {
      const client = new MockGitHubClient();

      const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
      const second = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

      expect(first).toBe(100);
      expect(second).toBe(101);

      const prs = client.getCreatedPRs();
      expect(prs.get(100)).toEqual({ repo: "owner/repo", head: "head-1", title: "Title 1", draft: true });
      expect(prs.get(101)).toEqual({ repo: "owner/repo", head: "head-2", title: "Title 2", draft: true });
    });

    it("markPRReady flips draft to false for an existing PR", async () => {
      const client = new MockGitHubClient();
      const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "Title", "Body");

      await client.markPRReady("owner/repo", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("markPRReady on a nonexistent PR resolves without throwing", async () => {
      const client = new MockGitHubClient();
      await expect(client.markPRReady("owner/repo", 999)).resolves.toBeUndefined();
    });
  });

  it("getPRDiff returns a fixed sample diff regardless of arguments", async () => {
    const client = new MockGitHubClient();

    const diff = await client.getPRDiff("owner/repo", 42);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 1)).resolves.toEqual([]);
  });

  it("commentOnPR resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("owner/repo", 1, "nice work")).resolves.toBeUndefined();
  });

  describe("createPRReviewComment", () => {
    it("returns sequential comment ids starting at 1000", async () => {
      const client = new MockGitHubClient();

      const first = await client.createPRReviewComment("owner/repo", 1, "comment", "src/a.ts", 10);
      const second = await client.createPRReviewComment("owner/repo", 1, "comment", "src/b.ts");

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 1, 1000, "thanks"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    const client = new MockGitHubClient();

    await expect(client.submitPRReview("owner/repo", 1, "lgtm", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("owner/repo", 1, "note", "COMMENT")).resolves.toBeUndefined();
  });
});
