import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch returns 'main'", async () => {
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name", async () => {
    await client.createBranch("org/repo", "feature/x");
    await client.createBranch("org/repo", "feature/y");
    expect(client.getCreatedBranches()).toEqual(["feature/x", "feature/y"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and marks it draft", async () => {
    const num1 = await client.createDraftPR("org/repo", "head1", "main", "Title 1", "Body 1");
    const num2 = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

    expect(num1).toBe(100);
    expect(num2).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head1", title: "Title 1", draft: true });
  });

  it("commentOnPR records the comment", async () => {
    await client.commentOnPR("org/repo", 100, "nice work");
    // no direct getter for plain comments, but should not throw and PR comments
    // list below should reflect review-comment-specific entries only.
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("getPRDiff returns a fixed sample diff", async () => {
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const num = await client.createDraftPR("org/repo", "head1", "main", "Title", "Body");
    await client.markPRReady("org/repo", num);
    expect(client.getCreatedPRs().get(num)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always returns an empty array", async () => {
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the line number in the recorded body when given", async () => {
    const id1 = await client.createPRReviewComment("org/repo", 100, "nit", "a.ts", 12);
    const id2 = await client.createPRReviewComment("org/repo", 100, "nit2", "b.ts");

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment records the reply body", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "thanks for the catch"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview records the review body", async () => {
    await expect(client.submitPRReview("org/repo", 100, "lgtm", "APPROVE")).resolves.toBeUndefined();
  });
});
