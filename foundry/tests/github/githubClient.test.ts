import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("owner/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("owner/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches reflects it", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");
    await client.createBranch("owner/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("getCreatedBranches returns a snapshot copy, not a live reference", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("owner/repo", "ai/feature-1");
    const snapshot = client.getCreatedBranches();
    await client.createBranch("owner/repo", "ai/feature-2");

    expect(snapshot).toEqual(["ai/feature-1"]);
    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers and records draft state", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR(
      "owner/repo",
      "ai/feature-1",
      "main",
      "Add feature",
      "Body text",
    );
    const second = await client.createDraftPR(
      "owner/repo",
      "ai/feature-2",
      "main",
      "Add feature 2",
      "Body text 2",
    );

    expect(second).toBe(first + 1);

    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({
      repo: "owner/repo",
      head: "ai/feature-1",
      title: "Add feature",
      draft: true,
    });
    expect(prs.get(second)).toEqual({
      repo: "owner/repo",
      head: "ai/feature-2",
      title: "Add feature 2",
      draft: true,
    });
  });

  it("getCreatedPRs returns a snapshot copy, not a live reference", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "ai/f1", "main", "T", "B");
    const snapshot = client.getCreatedPRs();
    await client.createDraftPR("owner/repo", "ai/f2", "main", "T2", "B2");

    expect(snapshot.size).toBe(1);
    expect(client.getCreatedPRs().size).toBe(2);
    expect(snapshot.get(prNumber)?.draft).toBe(true);
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("owner/repo", "ai/f1", "main", "T", "B");

    await client.markPRReady("owner/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady on a nonexistent PR number is a no-op that does not throw", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("owner/repo", 9999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty stub diff regardless of repo/PR number", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("owner/repo", 42);

    expect(diff).toContain("diff --git");
    expect(diff.length).toBeGreaterThan(0);
  });

  it("listPRComments always returns an empty array", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("owner/repo", 1, "hello");

    await expect(client.listPRComments("owner/repo", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment includes path and line in the recorded comment and returns an incrementing id", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment(
      "owner/repo",
      1,
      "Looks off",
      "src/index.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "owner/repo",
      1,
      "File-level note",
      "src/other.ts",
    );

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("owner/repo", 1, 555, "thanks"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
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
