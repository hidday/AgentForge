import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves verifyRepoAccess and getDefaultBranch without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch and getCreatedBranches returns a copy", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "feature/x");
    await client.createBranch("org/repo", "feature/y");

    const branches = client.getCreatedBranches();
    expect(branches).toEqual(["feature/x", "feature/y"]);

    branches.push("mutated");
    expect(client.getCreatedBranches()).toEqual(["feature/x", "feature/y"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "head1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head1", title: "Title 1", draft: true });
  });

  it("markPRReady flips draft to false for an existing PR and is a no-op for an unknown one", async () => {
    const client = new MockGitHubClient();
    const pr = await client.createDraftPR("org/repo", "head1", "main", "Title", "Body");

    await client.markPRReady("org/repo", pr);
    expect(client.getCreatedPRs().get(pr)?.draft).toBe(false);

    await expect(client.markPRReady("org/repo", 99999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment assigns incrementing comment ids starting at 1000", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment("org/repo", 100, "nit", "src/a.ts", 5);
    const second = await client.createPRReviewComment("org/repo", 100, "nit2", "src/b.ts");

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("org/repo", 100, "comment body")).resolves.toBeUndefined();
  });
});
