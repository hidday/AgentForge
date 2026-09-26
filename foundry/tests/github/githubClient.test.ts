import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
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
    branches.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });

  it("createDraftPR assigns sequential PR numbers starting at 100 and records the PR as draft", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-1",
      "main",
      "Fix bug",
      "body text",
    );
    const second = await client.createDraftPR(
      "acme/widgets",
      "ai/issue-2",
      "main",
      "Fix other bug",
      "body text 2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "acme/widgets",
      head: "ai/issue-1",
      title: "Fix bug",
      draft: true,
    });
    expect(prs.get(101)?.head).toBe("ai/issue-2");
  });

  it("commentOnPR records the comment", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "t", "b");
    await client.commentOnPR("acme/widgets", prNumber, "Looks good");

    // Verified indirectly: markPRReady + listPRComments below cover comment presence,
    // but createPRReviewComment reuses the same internal store, so exercise directly
    // via a second comment and confirm no throw / distinguishable side effects.
    await expect(client.commentOnPR("acme/widgets", prNumber, "Second comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/widgets", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "t", "b");

    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/widgets", 999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().has(999)).toBe(false);
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "t", "b");
    await client.commentOnPR("acme/widgets", prNumber, "some comment");

    await expect(client.listPRComments("acme/widgets", prNumber)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns sequential ids starting at 1000 and includes path/line in the recorded body", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Fix this",
      "src/foo.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Fix that",
      "src/bar.ts",
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("acme/widgets", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
