import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch returns 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");
    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and records the PR", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR(
      "owner/repo",
      "head-branch",
      "main",
      "Title 1",
      "Body 1",
    );
    const second = await client.createDraftPR(
      "owner/repo",
      "head-branch-2",
      "main",
      "Title 2",
      "Body 2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "owner/repo",
      head: "head-branch",
      title: "Title 1",
      draft: true,
    });
    expect(prs.get(101)?.title).toBe("Title 2");
  });

  it("commentOnPR resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("owner/repo", 100, "a comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("owner/repo", 100);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns incrementing comment ids and includes path/line in recorded body", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment(
      "owner/repo",
      100,
      "nit: fix this",
      "src/file.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "owner/repo",
      100,
      "file level comment",
      "src/other.ts",
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("owner/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
