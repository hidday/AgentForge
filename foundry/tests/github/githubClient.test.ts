import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("getCreatedBranches returns a copy, not a live reference", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");

    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs reflects the stored PR metadata including draft state", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "My PR", "desc");

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "owner/repo",
      head: "head-1",
      title: "My PR",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "My PR", "desc");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR and listPRComments: listPRComments always resolves empty (stub)", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("owner/repo", 100, "a comment");

    // listPRComments is a stub that does not read back posted comments.
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment formats the body with path and line and returns an incrementing id", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment(
      "owner/repo",
      100,
      "looks off",
      "src/index.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "owner/repo",
      100,
      "another",
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
      client.submitPRReview("owner/repo", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
