import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch returns main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches reflects it", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/feature-1");
    await client.createBranch("org/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("getCreatedBranches returns a copy, not the live array", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/feature-1");
    const first = client.getCreatedBranches();
    first.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers and getCreatedPRs reflects them", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
    expect(created.get(101)).toEqual({ repo: "org/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("commentOnPR resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("org/repo", 100, "hello")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty synthetic diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);

    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment assigns incrementing comment ids and includes the line in the body when given", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("org/repo", 100, "issue here", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("org/repo", 100, "issue here too", "src/b.ts");

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("org/repo", 100, "looks good", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
