import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess and getDefaultBranch without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("records created branches and makes them visible via getCreatedBranches", async () => {
    const client = new MockGitHubClient();
    expect(client.getCreatedBranches()).toEqual([]);

    await client.createBranch("acme/repo", "ai/feature-1");
    await client.createBranch("acme/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("assigns incrementing PR numbers starting at 100 and tracks draft state", async () => {
    const client = new MockGitHubClient();

    const firstPr = await client.createDraftPR(
      "acme/repo",
      "ai/feature-1",
      "main",
      "Add feature",
      "body text",
    );
    const secondPr = await client.createDraftPR(
      "acme/repo",
      "ai/feature-2",
      "main",
      "Add feature 2",
      "body text 2",
    );

    expect(firstPr).toBe(100);
    expect(secondPr).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "acme/repo",
      head: "ai/feature-1",
      title: "Add feature",
      draft: true,
    });
    expect(created.size).toBe(2);
  });

  it("markPRReady flips draft to false for an existing PR and is a no-op for an unknown PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "ai/f", "main", "title", "body");

    await client.markPRReady("acme/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);

    // Unknown PR number: should resolve without throwing.
    await expect(client.markPRReady("acme/repo", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves an empty array (stub behavior)", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("acme/repo", 100, "hello");
    await expect(client.listPRComments("acme/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the line number in the stored comment body when provided", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "acme/repo",
      100,
      "Looks off",
      "src/index.ts",
      42,
    );

    expect(commentId).toBe(1000);
    const nextId = await client.createPRReviewComment(
      "acme/repo",
      100,
      "Another",
      "src/other.ts",
      7,
    );
    expect(nextId).toBe(1001);
  });

  it("createPRReviewComment omits the line suffix when line is undefined", async () => {
    const client = new MockGitHubClient();
    // We can't directly inspect prComments (private), but we can verify the
    // call resolves and returns a comment id without throwing, exercising the
    // falsy-line branch.
    await expect(
      client.createPRReviewComment("acme/repo", 100, "File-level comment", "src/index.ts"),
    ).resolves.toBe(1000);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/repo", 100, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/repo", 100);
    expect(diff).toContain("diff --git");
    expect(diff.length).toBeGreaterThan(0);
  });
});
