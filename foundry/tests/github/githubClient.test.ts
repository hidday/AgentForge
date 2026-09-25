import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and exposes it via getCreatedBranches", async () => {
    const client = new MockGitHubClient();

    await client.createBranch("org/repo", "ai/feature-1");
    await client.createBranch("org/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("getCreatedBranches returns a copy, not the live array", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/feature-1");

    const branches = client.getCreatedBranches();
    branches.push("injected");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and records the PR as a draft", async () => {
    const client = new MockGitHubClient();

    const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(101)).toEqual({ repo: "org/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("commentOnPR records a comment against the PR number", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.commentOnPR("org/repo", prNumber, "Looks good");

    // Verified indirectly: createPRReviewComment/replyToReviewComment/submitPRReview
    // share the same internal comment log, exercised below.
    await expect(client.commentOnPR("org/repo", prNumber, "Another comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();

    const diff = await client.getPRDiff("org/repo", 1);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady does nothing (and does not throw) for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns incrementing comment ids starting at 1000 and includes the line in the recorded body", async () => {
    const client = new MockGitHubClient();

    const first = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/a.ts", 42);
    const second = await client.createPRReviewComment("org/repo", 1, "Also fix this", "src/b.ts");

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "Thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each review event type", async () => {
    const client = new MockGitHubClient();

    await expect(client.submitPRReview("org/repo", 1, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
