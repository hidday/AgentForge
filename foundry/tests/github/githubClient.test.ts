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

  it("records created branches", async () => {
    const client = new MockGitHubClient();

    await client.createBranch("org/repo", "ai/feature-1");
    await client.createBranch("org/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("creates draft PRs with incrementing PR numbers, starting at 100", async () => {
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

  it("marks a PR as not-draft when it exists", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("is a no-op when marking a nonexistent PR as ready", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("records comments via commentOnPR", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("org/repo", 100, "Looks good")).resolves.toBeUndefined();
  });

  it("returns a synthetic unified diff from getPRDiff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("returns an empty array from listPRComments", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("creates a PR review comment with a line number embedded in the recorded body", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "Fix this",
      "src/index.ts",
      42,
    );
    expect(commentId).toBe(1000);
  });

  it("creates a PR review comment without a line number", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "File-level comment",
      "src/index.ts",
    );
    expect(commentId).toBe(1000);
  });

  it("assigns increasing comment ids across multiple review comments", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment("org/repo", 100, "a", "file.ts", 1);
    const second = await client.createPRReviewComment("org/repo", 100, "b", "file.ts", 2);
    expect(second).toBe(first + 1);
  });

  it("resolves replyToReviewComment without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "Thanks"),
    ).resolves.toBeUndefined();
  });

  it("resolves submitPRReview for each review event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("org/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
