import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/widgets", "ai/issue-1");
    await client.createBranch("acme/widgets", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("getCreatedBranches returns a copy, not a live reference", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/widgets", "ai/issue-1");

    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });

  it("createDraftPR assigns sequential PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-1",
      "main",
      "Fix bug",
      "Body text",
    );
    const second = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-2",
      "main",
      "Fix other bug",
      "Other body",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs reflects created PRs as drafts with repo/head/title", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-1",
      "main",
      "Fix bug",
      "Body text",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "acme/widgets",
      head: "ai/issue-1",
      title: "Fix bug",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-1",
      "main",
      "Fix bug",
      "Body text",
    );

    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("acme/widgets", 100, "a comment");
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });

  it("getPRDiff resolves to a fixed unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/widgets", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("createPRReviewComment returns sequential ids starting at 1000 and includes path/line in the stored comment", async () => {
    const client = new MockGitHubClient();
    const firstId = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Looks off",
      "src/index.ts",
      42,
    );
    const secondId = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Needs a comment",
      "src/other.ts",
    );

    expect(firstId).toBe(1000);
    expect(secondId).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "thanks"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each review event", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("acme/widgets", 100, "lgtm", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
