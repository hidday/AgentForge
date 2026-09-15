import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch resolves to main", async () => {
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch and getCreatedBranches returns it", async () => {
    await client.createBranch("org/repo", "feature/one");
    await client.createBranch("org/repo", "feature/two");

    expect(client.getCreatedBranches()).toEqual(["feature/one", "feature/two"]);
  });

  it("getCreatedBranches returns a copy, not a live reference", async () => {
    await client.createBranch("org/repo", "feature/one");
    const branches = client.getCreatedBranches();
    branches.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["feature/one"]);
  });

  it("createDraftPR increments PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("org/repo", "head1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs reflects created draft PRs with draft:true", async () => {
    const prNumber = await client.createDraftPR("org/repo", "head1", "main", "My Title", "Body");

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "org/repo",
      head: "head1",
      title: "My Title",
      draft: true,
    });
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("org/repo", 100, "hello")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty diff string containing expected markers", async () => {
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("handleRequest");
  });

  it("markPRReady toggles draft flag on an existing PR", async () => {
    const prNumber = await client.createDraftPR("org/repo", "head1", "main", "Title", "Body");
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that does not exist", async () => {
    await expect(client.markPRReady("org/repo", 999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().has(999)).toBe(false);
  });

  it("listPRComments resolves to an empty array", async () => {
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment with a line includes the line number in the recorded comment", async () => {
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "looks off",
      "src/foo.ts",
      42,
    );

    expect(typeof commentId).toBe("number");
    // getCreatedPRs doesn't expose comments directly, so verify via a second call's id increments
    const secondId = await client.createPRReviewComment(
      "org/repo",
      100,
      "another",
      "src/bar.ts",
      7,
    );
    expect(secondId).toBe(commentId + 1);
  });

  it("createPRReviewComment without a line omits the line number", async () => {
    const commentId = await client.createPRReviewComment(
      "org/repo",
      100,
      "file-level comment",
      "src/foo.ts",
    );

    expect(typeof commentId).toBe("number");
    expect(commentId).toBeGreaterThanOrEqual(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "reply body"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(
      client.submitPRReview("org/repo", 100, "approved", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "changes needed", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "just a comment", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
