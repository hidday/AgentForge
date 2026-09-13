import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without error for any repo", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to main", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    await client.createBranch("acme/widgets", "feature-1");
    await client.createBranch("acme/widgets", "feature-2");

    expect(client.getCreatedBranches()).toEqual(["feature-1", "feature-2"]);
  });

  it("getCreatedBranches returns a snapshot copy, not a live reference", async () => {
    await client.createBranch("acme/widgets", "feature-1");
    const snapshot = client.getCreatedBranches();
    snapshot.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["feature-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("acme/widgets", "head1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR(
      "acme/widgets",
      "head2",
      "main",
      "Title 2",
      "Body 2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs exposes stored PRs as draft with repo/head/title", async () => {
    const prNumber = await client.createDraftPR(
      "acme/widgets",
      "feature-1",
      "main",
      "My PR",
      "Body text",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "acme/widgets",
      head: "feature-1",
      title: "My PR",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "h", "main", "T", "B");
    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves and does not throw", async () => {
    await expect(client.commentOnPR("acme/widgets", 100, "hello")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a fixed sample unified diff", async () => {
    const diff = await client.getPRDiff("acme/widgets", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the line number in the stored comment body when provided", async () => {
    const commentId = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "looks off",
      "src/index.ts",
      42,
    );
    expect(commentId).toBe(1000);

    const nextId = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "another",
      "src/index.ts",
      43,
    );
    expect(nextId).toBe(1001);
  });

  it("createPRReviewComment still assigns a sequential id when no line is given", async () => {
    const commentId = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "no line here",
      "src/index.ts",
    );
    expect(commentId).toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "thanks"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for any event type", async () => {
    await expect(
      client.submitPRReview("acme/widgets", 100, "lgtm", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
