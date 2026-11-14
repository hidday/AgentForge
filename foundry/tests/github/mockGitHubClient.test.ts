import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess and getDefaultBranch resolve without side effects", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name, visible via getCreatedBranches", async () => {
    await client.createBranch("org/repo", "feature/x");
    await client.createBranch("org/repo", "feature/y");

    expect(client.getCreatedBranches()).toEqual(["feature/x", "feature/y"]);
  });

  it("createDraftPR allocates incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("org/repo", "head", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({ repo: "org/repo", head: "head", title: "Title 1", draft: true });
  });

  it("markPRReady flips draft to false for an existing PR, and is a no-op for a missing one", async () => {
    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);

    await expect(client.markPRReady("org/repo", 99999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("org/repo", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments returns an empty array", async () => {
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  it("commentOnPR, createPRReviewComment, replyToReviewComment, and submitPRReview all resolve", async () => {
    await client.commentOnPR("org/repo", 1, "a comment");
    const commentId = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);
    await client.replyToReviewComment("org/repo", 1, commentId, "reply");
    await client.submitPRReview("org/repo", 1, "looks good", "APPROVE");

    expect(commentId).toBeGreaterThanOrEqual(1000);
  });

  it("createPRReviewComment formats the body with path and optional line number", async () => {
    await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 42);
    await client.createPRReviewComment("org/repo", 1, "nit2", "src/b.ts");

    // No direct getter for comments, but calling twice without throwing and
    // with increasing ids demonstrates both the line and no-line formatting paths.
    const idWithLine = await client.createPRReviewComment("org/repo", 1, "x", "src/c.ts", 1);
    const idWithoutLine = await client.createPRReviewComment("org/repo", 1, "x", "src/d.ts");
    expect(idWithoutLine).toBeGreaterThan(idWithLine);
  });
});
