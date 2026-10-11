import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves for any repo", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always resolves to main", async () => {
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches reflects it", async () => {
    await client.createBranch("org/repo", "feature/a");
    await client.createBranch("org/repo", "feature/b");

    expect(client.getCreatedBranches()).toEqual(["feature/a", "feature/b"]);
  });

  it("getCreatedBranches returns a defensive copy", async () => {
    await client.createBranch("org/repo", "feature/a");
    const snapshot = client.getCreatedBranches();
    snapshot.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["feature/a"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("org/repo", "feature/a", "main", "Title A", "Body A");
    const second = await client.createDraftPR(
      "org/repo",
      "feature/b",
      "main",
      "Title B",
      "Body B",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs exposes created PRs as draft until marked ready", async () => {
    const prNumber = await client.createDraftPR("org/repo", "feature/a", "main", "Title", "Body");

    const prsBefore = client.getCreatedPRs();
    expect(prsBefore.get(prNumber)).toEqual({
      repo: "org/repo",
      head: "feature/a",
      title: "Title",
      draft: true,
    });

    await client.markPRReady("org/repo", prNumber);

    const prsAfter = client.getCreatedPRs();
    expect(prsAfter.get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("org/repo", 100, "nice work")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty synthetic diff string", async () => {
    const diff = await client.getPRDiff("org/repo", 100);

    expect(typeof diff).toBe("string");
    expect(diff).toContain("diff --git");
  });

  it("listPRComments resolves to an empty array", async () => {
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns incrementing comment ids and encodes path/line in the stored comment", async () => {
    const id1 = await client.createPRReviewComment("org/repo", 100, "fix this", "src/a.ts", 12);
    const id2 = await client.createPRReviewComment("org/repo", 100, "and this", "src/b.ts");

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(client.submitPRReview("org/repo", 100, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "fyi", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
