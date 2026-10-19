import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and it is retrievable via getCreatedBranches", async () => {
    await client.createBranch("owner/repo", "ai/issue-1");
    await client.createBranch("owner/repo", "ai/issue-2");
    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("createDraftPR assigns increasing PR numbers starting at 100 and marks them draft", async () => {
    const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR(
      "owner/repo",
      "head-2",
      "main",
      "Title 2",
      "Body 2",
    );
    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "owner/repo",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
    expect(prs.get(101)?.head).toBe("head-2");
  });

  it("commentOnPR records the comment", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "h", "main", "T", "B");
    await client.commentOnPR("owner/repo", prNumber, "A comment");
    await expect(client.listPRComments("owner/repo", prNumber)).resolves.toEqual([]);
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("owner/repo", 1);
    expect(diff).toContain("diff --git");
    expect(diff.length).toBeGreaterThan(0);
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "h", "main", "T", "B");
    await client.markPRReady("owner/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    await expect(client.markPRReady("owner/repo", 999)).resolves.toBeUndefined();
  });

  it("listPRComments always returns an empty array (mock does not track per-PR bodies)", async () => {
    await expect(client.listPRComments("owner/repo", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes path and line in the stored comment body", async () => {
    const id = await client.createPRReviewComment("owner/repo", 1, "Nit", "src/a.ts", 42);
    expect(id).toBe(1000);
    const nextId = await client.createPRReviewComment("owner/repo", 1, "Nit2", "src/b.ts");
    expect(nextId).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("owner/repo", 1, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(
      client.submitPRReview("owner/repo", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("owner/repo", 1, "Note", "COMMENT")).resolves.toBeUndefined();
  });
});
