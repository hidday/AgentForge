import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess without throwing regardless of repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("returns 'main' as the default branch", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "feature-1");
    await client.createBranch("owner/repo", "feature-2");

    expect(client.getCreatedBranches()).toEqual(["feature-1", "feature-2"]);
  });

  it("getCreatedBranches returns a defensive copy", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "feature-1");
    const first = client.getCreatedBranches();
    first.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["feature-1"]);
  });

  it("creates draft PRs with incrementing numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("owner/repo", "head1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("owner/repo", "head2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "owner/repo",
      head: "head1",
      title: "Title 1",
      draft: true,
    });
    expect(created.get(101)).toEqual({
      repo: "owner/repo",
      head: "head2",
      title: "Title 2",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("owner/repo", 100, "hello")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a fixed diff string containing a patch header", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("owner/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("handleRequest");
  });

  it("listPRComments returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns incrementing comment ids starting at 1000, including the line in the tracked body", async () => {
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
      "another note",
      "src/other.ts",
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without error for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("owner/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
