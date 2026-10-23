import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    await expect(client.verifyRepoAccess("acme/backend-api")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    await expect(client.getDefaultBranch("acme/backend-api")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches reflects it", async () => {
    await client.createBranch("acme/backend-api", "ai/issue-1");
    await client.createBranch("acme/backend-api", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("getCreatedBranches returns a defensive copy", async () => {
    await client.createBranch("acme/backend-api", "ai/issue-1");
    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR(
      "acme/backend-api",
      "ai/issue-1",
      "main",
      "Add feature",
      "body",
    );
    const second = await client.createDraftPR(
      "acme/backend-api",
      "ai/issue-2",
      "main",
      "Add another feature",
      "body2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs reflects created PRs as drafts", async () => {
    await client.createDraftPR("acme/backend-api", "ai/issue-1", "main", "Add feature", "body");

    const prs = client.getCreatedPRs();
    expect(prs.size).toBe(1);
    expect(prs.get(100)).toEqual({
      repo: "acme/backend-api",
      head: "ai/issue-1",
      title: "Add feature",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR(
      "acme/backend-api",
      "ai/issue-1",
      "main",
      "Add feature",
      "body",
    );

    await client.markPRReady("acme/backend-api", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op (does not throw) for an unknown PR number", async () => {
    await expect(client.markPRReady("acme/backend-api", 9999)).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(
      client.commentOnPR("acme/backend-api", 100, "Looks good"),
    ).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("acme/backend-api", 100);

    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("listPRComments returns an empty array by default", async () => {
    await expect(client.listPRComments("acme/backend-api", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns an incrementing comment id starting at 1000", async () => {
    const first = await client.createPRReviewComment(
      "acme/backend-api",
      100,
      "Nit: rename var",
      "src/handler.ts",
      12,
    );
    const second = await client.createPRReviewComment(
      "acme/backend-api",
      100,
      "Another nit",
      "src/handler.ts",
      20,
    );

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment omits the line suffix when no line is provided", async () => {
    const id = await client.createPRReviewComment(
      "acme/backend-api",
      100,
      "File-level comment",
      "src/handler.ts",
    );

    expect(id).toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/backend-api", 100, 1000, "Fixed in latest commit"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each review event type", async () => {
    await expect(
      client.submitPRReview("acme/backend-api", 100, "Looks good", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/backend-api", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/backend-api", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
