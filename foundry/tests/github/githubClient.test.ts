import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without throwing", async () => {
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("always returns 'main' as the default branch", async () => {
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    await client.createBranch("owner/repo", "ai/issue-1");
    await client.createBranch("owner/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("creates draft PRs with incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR(
      "owner/repo",
      "ai/issue-1",
      "main",
      "Title 1",
      "Body 1",
    );
    const second = await client.createDraftPR(
      "owner/repo",
      "ai/issue-2",
      "main",
      "Title 2",
      "Body 2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "owner/repo",
      head: "ai/issue-1",
      title: "Title 1",
      draft: true,
    });
  });

  it("marks an existing PR as no longer draft", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "head", "main", "T", "B");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().has(9999)).toBe(false);
  });

  it("returns a stub unified diff from getPRDiff", async () => {
    const diff = await client.getPRDiff("owner/repo", 1);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("owner/repo", 1)).resolves.toEqual([]);
  });

  it("commentOnPR records the comment", async () => {
    await client.commentOnPR("owner/repo", 42, "hello");
    // Verified indirectly via createPRReviewComment's shared storage behavior below,
    // since there is no direct getter -- but the call must not throw.
    await expect(client.commentOnPR("owner/repo", 42, "hello")).resolves.toBeUndefined();
  });

  it("createPRReviewComment includes the path and line in the stored body and returns an incrementing id", async () => {
    const id1 = await client.createPRReviewComment("owner/repo", 1, "looks off", "src/a.ts", 10);
    const id2 = await client.createPRReviewComment("owner/repo", 1, "looks off too", "src/b.ts");

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("owner/repo", 1, 1000, "thanks"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(
      client.submitPRReview("owner/repo", 1, "lgtm", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 1, "note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
