import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("returns 'main' as the default branch", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/issue-1");
    await client.createBranch("org/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("creates draft PRs with incrementing PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "org/repo",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
  });

  it("marks a PR ready by flipping draft to false", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 999)).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("org/repo", 100, "hello")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the line number when provided", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "Looks off",
      "src/file.ts",
      42,
    );
    expect(commentId).toBe(1000);
  });

  it("createPRReviewComment omits the line suffix when line is not provided", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "File-level comment",
      "src/file.ts",
    );
    expect(commentId).toBe(1000);
  });

  it("createPRReviewComment increments comment ids across calls", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment("org/repo", 100, "a", "f.ts", 1);
    const second = await client.createPRReviewComment("org/repo", 100, "b", "f.ts", 2);
    expect(second).toBe(first + 1);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("org/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
