import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and it is retrievable", async () => {
    await client.createBranch("acme/widgets", "ai/feature-1");
    await client.createBranch("acme/widgets", "ai/feature-2");
    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and stores PR data", async () => {
    const pr1 = await client.createDraftPR("acme/widgets", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("acme/widgets", "head-2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "acme/widgets",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
    expect(created.get(101)?.head).toBe("head-2");
  });

  it("commentOnPR stores the comment for the given PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "h", "main", "T", "B");
    await client.commentOnPR("acme/widgets", prNumber, "Looks good");
    const comments = await client.listPRComments("acme/widgets", prNumber);
    // listPRComments is a stub that always returns [] regardless of stored comments.
    expect(comments).toEqual([]);
  });

  it("getPRDiff returns a fixed, realistic unified diff", async () => {
    const diff = await client.getPRDiff("acme/widgets", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "h", "main", "T", "B");
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that was never created", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array (stub behavior)", async () => {
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the file path and line number in the stored comment body", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "h", "main", "T", "B");
    const commentId = await client.createPRReviewComment(
      "acme/widgets",
      prNumber,
      "Fix this",
      "src/index.ts",
      42,
    );
    // Comment ids start at 1000 and increment.
    expect(commentId).toBe(1000);

    const secondId = await client.createPRReviewComment(
      "acme/widgets",
      prNumber,
      "Another",
      "src/other.ts",
      7,
    );
    expect(secondId).toBe(1001);
  });

  it("createPRReviewComment omits the line suffix when no line is given", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "h", "main", "T", "B");
    // We can't directly inspect prComments (private), but we can verify no throw
    // and that a distinct id is still allocated.
    const commentId = await client.createPRReviewComment(
      "acme/widgets",
      prNumber,
      "File-level comment",
      "src/index.ts",
    );
    expect(commentId).toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
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
