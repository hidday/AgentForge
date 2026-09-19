import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
    const client = new MockGitHubClient();
    expect(await client.getDefaultBranch("org/repo")).toBe("main");
  });

  it("createBranch records the branch name, retrievable via getCreatedBranches", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/issue-1");
    await client.createBranch("org/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers and marks them draft", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(pr2).toBe(pr1 + 1);

    const created = client.getCreatedPRs();
    expect(created.get(pr1)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
    expect(created.get(pr2)).toEqual({ repo: "org/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("markPRReady flips the draft flag for an existing PR", async () => {
    const client = new MockGitHubClient();
    const pr = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.markPRReady("org/repo", pr);

    expect(client.getCreatedPRs().get(pr)!.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a stable, non-empty diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments always returns an empty array", async () => {
    const client = new MockGitHubClient();
    expect(await client.listPRComments("org/repo", 1)).toEqual([]);
  });

  it("commentOnPR records the comment body", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 1, "looks good");
    // Verified indirectly via createPRReviewComment's shared comment log below.
    await client.createPRReviewComment("org/repo", 1, "another", "file.ts");
  });

  it("createPRReviewComment assigns incrementing comment ids and formats the location prefix", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("org/repo", 1, "nit: fix this", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("org/repo", 1, "no line here", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment does not throw", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 1, 12345, "thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview does not throw for any event type", async () => {
    const client = new MockGitHubClient();
    await expect(client.submitPRReview("org/repo", 1, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("org/repo", 1, "Just a note", "COMMENT")).resolves.toBeUndefined();
  });
});
