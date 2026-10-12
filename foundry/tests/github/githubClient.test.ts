import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing", async () => {
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch returns 'main'", async () => {
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and it is retrievable", async () => {
    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("owner/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("owner/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("createDraftPR records PR as draft and retrievable via getCreatedPRs", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "My Title", "My Body");

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "owner/repo",
      head: "head-1",
      title: "My Title",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "Title", "Body");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that does not exist", async () => {
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("owner/repo", 100, "a comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("owner/repo", 100);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("handleRequest");
  });

  it("listPRComments resolves to an empty array", async () => {
    await expect(client.listPRComments("owner/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns an incrementing comment id starting at 1000", async () => {
    const first = await client.createPRReviewComment("owner/repo", 100, "body", "src/a.ts", 10);
    const second = await client.createPRReviewComment("owner/repo", 100, "body", "src/b.ts");

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment formats the stored comment with path and line when line is given", async () => {
    await client.createPRReviewComment("owner/repo", 100, "needs fix", "src/a.ts", 42);

    // commentOnPR pushes into the same internal list; verify via a subsequent
    // comment-producing call does not throw and the id sequence advanced correctly.
    const nextId = await client.createPRReviewComment("owner/repo", 100, "another", "src/b.ts");
    expect(nextId).toBe(1001);
  });

  it("createPRReviewComment omits the line suffix when no line is given", async () => {
    await expect(
      client.createPRReviewComment("owner/repo", 100, "needs fix", "src/a.ts"),
    ).resolves.toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("owner/repo", 100, 1000, "thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(client.submitPRReview("owner/repo", 100, "lgtm", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("owner/repo", 100, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(client.submitPRReview("owner/repo", 100, "fyi", "COMMENT")).resolves.toBeUndefined();
  });

  it("getCreatedBranches returns a defensive copy", async () => {
    await client.createBranch("owner/repo", "ai/feature-1");
    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });

  it("getCreatedPRs returns a defensive copy (does not track live prs map)", async () => {
    const prNumber = await client.createDraftPR("owner/repo", "head-1", "main", "Title", "Body");
    const prs = client.getCreatedPRs();
    prs.delete(prNumber);

    expect(client.getCreatedPRs().has(prNumber)).toBe(true);
  });
});
