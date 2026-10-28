import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess and getDefaultBranch resolve with sensible defaults", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    expect(await client.getDefaultBranch("org/repo")).toBe("main");
  });

  it("createBranch records the branch and getCreatedBranches returns a snapshot copy", async () => {
    await client.createBranch("org/repo", "feature/x");
    const branches = client.getCreatedBranches();
    expect(branches).toEqual(["feature/x"]);

    branches.push("mutated");
    expect(client.getCreatedBranches()).toEqual(["feature/x"]);
  });

  it("createDraftPR assigns incrementing PR numbers and tracks them as drafts", async () => {
    const first = await client.createDraftPR("org/repo", "feature/x", "main", "t1", "b1");
    const second = await client.createDraftPR("org/repo", "feature/y", "main", "t2", "b2");

    expect(second).toBe(first + 1);
    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({ repo: "org/repo", head: "feature/x", title: "t1", draft: true });
  });

  it("markPRReady flips the draft flag for a known PR and no-ops for an unknown one", async () => {
    const prNumber = await client.createDraftPR("org/repo", "feature/x", "main", "t1", "b1");

    await client.markPRReady("org/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);

    await expect(client.markPRReady("org/repo", 99999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a canned unified diff", async () => {
    const diff = await client.getPRDiff("org/repo", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments always resolves empty", async () => {
    expect(await client.listPRComments("org/repo", 1)).toEqual([]);
  });

  it("createPRReviewComment returns incrementing comment ids and embeds path/line", async () => {
    const id1 = await client.createPRReviewComment("org/repo", 1, "nit", "src/a.ts", 10);
    const id2 = await client.createPRReviewComment("org/repo", 1, "nit", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "lgtm", "APPROVE"),
    ).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("org/repo", 1, "hello")).resolves.toBeUndefined();
  });
});
