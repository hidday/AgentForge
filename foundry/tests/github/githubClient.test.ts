import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess and getDefaultBranch as no-op successes", async () => {
    const client = new MockGitHubClient();

    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("records created branches", async () => {
    const client = new MockGitHubClient();

    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("creates draft PRs with incrementing numbers starting at 100", async () => {
    const client = new MockGitHubClient();

    const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "owner/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(101)).toEqual({ repo: "owner/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("marks an existing PR as ready, flipping draft to false", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("does nothing when marking a nonexistent PR as ready", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
  });

  it("returns an empty diff via getPRDiff that includes a unified diff header", async () => {
    const client = new MockGitHubClient();

    const diff = await client.getPRDiff("owner/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
  });

  it("returns an empty array from listPRComments", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("creates PR review comments with incrementing ids starting at 1000, formatting path and line", async () => {
    const client = new MockGitHubClient();

    const withLine = await client.createPRReviewComment(
      "owner/repo",
      100,
      "fix this",
      "src/handler.ts",
      42,
    );
    const withoutLine = await client.createPRReviewComment(
      "owner/repo",
      100,
      "fix this too",
      "src/other.ts",
    );

    expect(withLine).toBe(1000);
    expect(withoutLine).toBe(1001);
  });

  it("resolves commentOnPR, replyToReviewComment, and submitPRReview without throwing", async () => {
    const client = new MockGitHubClient();

    await expect(client.commentOnPR("owner/repo", 100, "a comment")).resolves.toBeUndefined();
    await expect(
      client.replyToReviewComment("owner/repo", 100, 1000, "a reply"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "looks good", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
