import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without error for any repo", async () => {
    await expect(client.verifyRepoAccess("any/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns 'main'", async () => {
    await expect(client.getDefaultBranch("any/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    await client.createBranch("acme/widgets", "feature/one");
    await client.createBranch("acme/widgets", "feature/two");

    expect(client.getCreatedBranches()).toEqual(["feature/one", "feature/two"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and tracks the PR", async () => {
    const num1 = await client.createDraftPR("acme/widgets", "feat-1", "main", "Title 1", "Body 1");
    const num2 = await client.createDraftPR("acme/widgets", "feat-2", "main", "Title 2", "Body 2");

    expect(num1).toBe(100);
    expect(num2).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "acme/widgets",
      head: "feat-1",
      title: "Title 1",
      draft: true,
    });
    expect(prs.get(101)?.title).toBe("Title 2");
  });

  it("markPRReady flips draft to false for a known PR and is a no-op for an unknown PR", async () => {
    const num = await client.createDraftPR("acme/widgets", "feat", "main", "T", "B");
    await client.markPRReady("acme/widgets", num);

    expect(client.getCreatedPRs().get(num)?.draft).toBe(false);

    await expect(client.markPRReady("acme/widgets", 99999)).resolves.toBeUndefined();
  });

  it("getPRDiff returns a realistic non-empty unified diff", async () => {
    const diff = await client.getPRDiff("acme/widgets", 1);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("listPRComments always returns an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 1)).resolves.toEqual([]);
  });

  it("commentOnPR is a no-op that resolves", async () => {
    await expect(client.commentOnPR("acme/widgets", 1, "hi")).resolves.toBeUndefined();
  });

  it("createPRReviewComment returns incrementing comment ids starting at 1000, formatting path/line into the tracked body", async () => {
    const id1 = await client.createPRReviewComment("acme/widgets", 1, "nit", "src/a.ts", 12);
    const id2 = await client.createPRReviewComment("acme/widgets", 1, "note", "src/b.ts");

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 1, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
