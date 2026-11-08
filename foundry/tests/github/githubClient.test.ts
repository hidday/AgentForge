import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns all of them", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/widgets", "ai/issue-1");
    await client.createBranch("acme/widgets", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("acme/widgets", "ai/issue-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "acme/widgets",
      head: "ai/issue-1",
      title: "Title 1",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR and is a no-op for an unknown PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Title", "Body");

    await client.markPRReady("acme/widgets", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);

    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/widgets", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("acme/widgets", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment assigns incrementing comment ids and embeds path/line in the body", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("acme/widgets", 1, "nit", "src/a.ts", 10);
    const id2 = await client.createPRReviewComment("acme/widgets", 1, "nit2", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/widgets", 1, 500, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 1, "looks good", "APPROVE"),
    ).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("acme/widgets", 1, "a comment")).resolves.toBeUndefined();
  });
});
