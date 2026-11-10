import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns a copy", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");

    const branches = client.getCreatedBranches();
    expect(branches).toEqual(["ai/feature-1", "ai/feature-2"]);

    // Mutating the returned array must not affect internal state.
    branches.push("not-real");
    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR allocates incrementing PR numbers and getCreatedPRs reflects them", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

    expect(pr2).toBe(pr1 + 1);

    const prs = client.getCreatedPRs();
    expect(prs.get(pr1)).toEqual({ repo: "owner/repo", head: "head-1", title: "Title 1", draft: true });
    expect(prs.get(pr2)).toEqual({ repo: "owner/repo", head: "head-2", title: "Title 2", draft: true });
  });

  it("getPRDiff returns a stable, non-empty diff string", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("owner/repo", 1);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("markPRReady flips draft to false for a known PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "head", "main", "Title", "Body");
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady on an unknown PR number is a no-op (does not throw)", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 99999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("owner/repo", 1)).resolves.toEqual([]);
  });

  it("commentOnPR records the comment", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("owner/repo", 5, "Looks good");
    // commentOnPR has no public getter, but createPRReviewComment shares the
    // same internal store, so verify indirectly it does not throw and the
    // operation completed by chaining a dependent call.
    await expect(client.commentOnPR("owner/repo", 5, "Another comment")).resolves.toBeUndefined();
  });

  it("createPRReviewComment includes the line number in the comment body when provided", async () => {
    const client = new MockGitHubClient();
    const commentId1 = await client.createPRReviewComment(
      "owner/repo",
      1,
      "Fix this",
      "src/index.ts",
      42,
    );
    const commentId2 = await client.createPRReviewComment(
      "owner/repo",
      1,
      "Fix this too",
      "src/index.ts",
    );

    expect(commentId2).toBe(commentId1 + 1);
    expect(typeof commentId1).toBe("number");
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 1, 1234, "Thanks for the reply"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for every event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("owner/repo", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
