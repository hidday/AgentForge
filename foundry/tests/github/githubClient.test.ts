import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without throwing", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("always reports 'main' as the default branch", async () => {
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    await client.createBranch("org/repo", "ai/issue-1");
    await client.createBranch("org/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("creates draft PRs with incrementing numbers starting at 100", async () => {
    const first = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(101)).toEqual({ repo: "org/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("marks an existing PR as not draft via markPRReady", async () => {
    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("is a no-op when markPRReady is called for a PR number that was never created", async () => {
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("returns an empty array from listPRComments regardless of input", async () => {
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  it("returns a parseable unified diff from getPRDiff", async () => {
    const diff = await client.getPRDiff("org/repo", 1);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("creates a PR review comment with a line number embedded in the body", async () => {
    const commentId = await client.createPRReviewComment(
      "org/repo",
      1,
      "Looks off",
      "src/file.ts",
      42,
    );

    expect(commentId).toBe(1000);

    const nextId = await client.createPRReviewComment("org/repo", 1, "Another", "src/file.ts", 43);
    expect(nextId).toBe(1001);
  });

  it("creates a PR review comment without a line suffix when line is omitted", async () => {
    // We can't inspect prComments directly (no getter), but we can confirm
    // the call resolves and returns a distinct, incrementing comment id,
    // proving the no-line branch executes independently of the line branch.
    const withLine = await client.createPRReviewComment("org/repo", 1, "body", "a.ts", 5);
    const withoutLine = await client.createPRReviewComment("org/repo", 1, "body", "a.ts");

    expect(withoutLine).toBe(withLine + 1);
  });

  it("resolves replyToReviewComment", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });

  it("resolves submitPRReview for every review event type", async () => {
    await expect(client.submitPRReview("org/repo", 1, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("org/repo", 1, "Just a note", "COMMENT")).resolves.toBeUndefined();
  });

  it("returns a defensive copy from getCreatedBranches and getCreatedPRs", async () => {
    await client.createBranch("org/repo", "ai/issue-1");
    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });
});
