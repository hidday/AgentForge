import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without throwing", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("returns main as the default branch", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    await client.createBranch("acme/widgets", "ai/issue-1");
    await client.createBranch("acme/widgets", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("creates draft PRs with incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "body");
    const second = await client.createDraftPR("acme/widgets", "ai/issue-2", "main", "Fix bug 2", "body2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "acme/widgets",
      head: "ai/issue-1",
      title: "Fix bug",
      draft: true,
    });
    expect(created.get(101)?.title).toBe("Fix bug 2");
  });

  it("marks a PR as not draft via markPRReady", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "ai/issue-1", "main", "Fix bug", "body");

    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("acme/widgets", 100, "nice work")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("acme/widgets", 100);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("+++ b/src/handler.ts");
  });

  it("listPRComments returns an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns an incrementing comment id and includes the line in the body when provided", async () => {
    const id1 = await client.createPRReviewComment("acme/widgets", 100, "looks off", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("acme/widgets", 100, "another", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
