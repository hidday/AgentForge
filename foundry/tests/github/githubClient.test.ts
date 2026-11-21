import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess() and getDefaultBranch() resolve with 'main' without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch() records the branch name", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/lin-1");
    await client.createBranch("org/repo", "ai/lin-2");
    expect(client.getCreatedBranches()).toEqual(["ai/lin-1", "ai/lin-2"]);
  });

  it("createDraftPR() allocates increasing PR numbers starting at 100 and records the PR as draft", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
  });

  it("markPRReady() flips an existing PR's draft flag to false", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady() on an unknown PR number is a safe no-op", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("getPRDiff() returns a stable, non-empty synthetic diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments() returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment() allocates increasing comment ids and embeds the path/line in the recorded body", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("org/repo", 100, "Looks off", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("org/repo", 100, "Another one", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment() and submitPRReview() resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.replyToReviewComment("org/repo", 100, 1000, "ack")).resolves.toBeUndefined();
    await expect(client.submitPRReview("org/repo", 100, "summary", "APPROVE")).resolves.toBeUndefined();
  });

  it("commentOnPR() resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("org/repo", 100, "a comment")).resolves.toBeUndefined();
  });
});
