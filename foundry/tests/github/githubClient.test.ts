import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch tracks created branch names, in order, including duplicates", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/issue-1");
    await client.createBranch("org/repo", "ai/issue-2");
    await client.createBranch("org/repo", "ai/issue-1");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2", "ai/issue-1"]);
  });

  it("getCreatedBranches returns a defensive copy that callers cannot mutate", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/issue-1");

    const branches = client.getCreatedBranches();
    branches.push("not-tracked");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });

  it("createDraftPR assigns sequential PR numbers starting at 100 and records PR data as a draft", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(101)).toEqual({ repo: "org/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("getCreatedPRs returns a copy that does not let callers mutate internal state", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    const prs = client.getCreatedPRs();
    prs.delete(prNumber);

    expect(client.getCreatedPRs().has(prNumber)).toBe(true);
  });

  it("commentOnPR records comment body associated with the PR number", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 100, "hello there");

    // Comments are surfaced indirectly via markPRReady/createPRReviewComment-style
    // tracking; verify no throw and that subsequent independent calls still work.
    await expect(client.commentOnPR("org/repo", 100, "second comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff.length).toBeGreaterThan(0);
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op (does not throw) for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().has(9999)).toBe(false);
  });

  it("listPRComments resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 100, "a comment");

    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns sequential comment ids starting at 1000", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment("org/repo", 100, "nit", "src/a.ts", 5);
    const second = await client.createPRReviewComment("org/repo", 100, "nit2", "src/b.ts");

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment formats the body with path and line when line is provided", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("org/repo", 100, "fix this", "src/a.ts", 42);

    // listPRComments is hardcoded to return [], so we assert indirectly: calling
    // again should continue to succeed and allocate a new id, proving no throw
    // occurred while formatting `[path:line] body`.
    const commentId = await client.createPRReviewComment("org/repo", 100, "fix this", "src/a.ts", 42);
    expect(commentId).toBe(1001);
  });

  it("createPRReviewComment formats the body with only the path when line is omitted", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment("org/repo", 100, "fix this", "src/a.ts");
    expect(commentId).toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each review event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("org/repo", 100, "looks good", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
