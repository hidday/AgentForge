import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

// MockGitHubClient records comment/reply/review bodies in a private `prComments`
// array with no public getter. We reach into it via a narrow cast so we can assert
// on the exact formatted strings the implementation produces, per the testing policy
// requiring assertions on meaningful outcomes rather than just "did not throw".
function getPrComments(client: MockGitHubClient): { prNumber: number; body: string }[] {
  return (client as unknown as { prComments: { prNumber: number; body: string }[] }).prComments;
}

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch resolves to 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch appends the branch name to getCreatedBranches()", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "feature/one");
    await client.createBranch("owner/repo", "feature/two");

    expect(client.getCreatedBranches()).toEqual(["feature/one", "feature/two"]);
  });

  it("getCreatedBranches returns a defensive copy", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "feature/one");
    const branches = client.getCreatedBranches();
    branches.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["feature/one"]);
  });

  it("createDraftPR assigns auto-incrementing PR numbers starting at 100 and stores draft: true", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "owner/repo",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
    expect(prs.get(101)).toEqual({
      repo: "owner/repo",
      head: "head-2",
      title: "Title 2",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a silent no-op for a PR number that doesn't exist", async () => {
    const client = new MockGitHubClient();

    await expect(client.markPRReady("owner/repo", 999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves without error and records the comment", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.commentOnPR("owner/repo", 100, "a comment"),
    ).resolves.toBeUndefined();

    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "a comment" }]);
  });

  it("getPRDiff returns the fixed diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("owner/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("listPRComments always returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment assigns auto-incrementing ids starting at 1000 and formats path:line in the body", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment(
      "owner/repo",
      100,
      "Fix this",
      "src/handler.ts",
      42,
    );
    const second = await client.createPRReviewComment(
      "owner/repo",
      100,
      "Also fix this",
      "src/other.ts",
      7,
    );

    expect(first).toBe(1000);
    expect(second).toBe(1001);

    const comments = getPrComments(client);
    expect(comments[0]).toEqual({ prNumber: 100, body: "[src/handler.ts:42] Fix this" });
    expect(comments[1]).toEqual({ prNumber: 100, body: "[src/other.ts:7] Also fix this" });
  });

  it("createPRReviewComment includes 'path:line' in the formatted body when line is provided", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("owner/repo", 100, "Fix this", "src/handler.ts", 42);

    const [comment] = getPrComments(client);
    expect(comment.body).toBe("[src/handler.ts:42] Fix this");
    expect(comment.body).toContain(":42");
  });

  it("createPRReviewComment does NOT include a colon-number when line is omitted", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "owner/repo",
      100,
      "Fix this",
      "src/handler.ts",
    );

    expect(commentId).toBe(1000);
    const [comment] = getPrComments(client);
    expect(comment.body).toBe("[src/handler.ts] Fix this");
    expect(comment.body).not.toMatch(/:\d/);
  });

  it("replyToReviewComment resolves without error and records the reply", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();

    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "reply body" }]);
  });

  it("submitPRReview resolves without error and records the review body", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("owner/repo", 100, "review body", "APPROVE"),
    ).resolves.toBeUndefined();

    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "review body" }]);
  });
});
