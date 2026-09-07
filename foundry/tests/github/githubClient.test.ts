import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess and getDefaultBranch resolve without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and exposes it via getCreatedBranches", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/repo", "ai/feature-1");
    await client.createBranch("acme/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers and records the PR as draft", async () => {
    const client = new MockGitHubClient();

    const first = await client.createDraftPR("acme/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("acme/repo", "head-2", "main", "Title 2", "Body 2");

    expect(second).toBe(first + 1);
    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({ repo: "acme/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(second)).toEqual({ repo: "acme/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "head", "main", "T", "B");

    await client.markPRReady("acme/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that doesn't exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/repo", 9999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/repo", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("acme/repo", 1)).resolves.toEqual([]);
  });

  it("commentOnPR does not throw", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("acme/repo", 1, "a comment")).resolves.toBeUndefined();
  });

  it("createPRReviewComment returns incrementing comment ids and formats the path/line prefix", async () => {
    const client = new MockGitHubClient();

    const id1 = await client.createPRReviewComment("acme/repo", 1, "fix this", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("acme/repo", 1, "fix that", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment does not throw", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/repo", 1, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview does not throw for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(client.submitPRReview("acme/repo", 1, "lgtm", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 1, "needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("acme/repo", 1, "fyi", "COMMENT")).resolves.toBeUndefined();
  });
});
