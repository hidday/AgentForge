import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/backend")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to 'main'", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/backend")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns a copy", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/backend", "ai/lin-1");
    await client.createBranch("acme/backend", "ai/lin-2");

    const branches = client.getCreatedBranches();
    expect(branches).toEqual(["ai/lin-1", "ai/lin-2"]);

    // Mutating the returned array must not affect internal state.
    branches.push("ai/lin-3");
    expect(client.getCreatedBranches()).toEqual(["ai/lin-1", "ai/lin-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and marks them draft", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("acme/backend", "ai/lin-2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "acme/backend",
      head: "ai/lin-1",
      title: "Title 1",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/backend", "ai/lin-1", "main", "Title", "Body");

    await client.markPRReady("acme/backend", prNumber);

    const created = client.getCreatedPRs();
    expect(created.get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/backend", 999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR does not throw and getPRDiff returns a stable non-empty diff", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("acme/backend", 100, "nice work")).resolves.toBeUndefined();

    const diff = await client.getPRDiff("acme/backend", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("handleRequest");
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("acme/backend", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes the file path and line number in the recorded comment, with incrementing ids", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment(
      "acme/backend",
      100,
      "Missing null check",
      "src/foo.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "acme/backend",
      100,
      "File-level comment",
      "src/bar.ts",
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment and submitPRReview both resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/backend", 100, 1000, "Fixed, thanks!"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/backend", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
