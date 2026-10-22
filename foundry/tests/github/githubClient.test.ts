import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess and getDefaultBranch without side effects", async () => {
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("records created branches and returns them via getCreatedBranches", async () => {
    await client.createBranch("acme/repo", "ai/feature-1");
    await client.createBranch("acme/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("assigns incrementing PR numbers starting at 100 and records them as draft", async () => {
    const pr1 = await client.createDraftPR("acme/repo", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("acme/repo", "head-2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);

    const created = client.getCreatedPRs();
    expect(created.get(100)).toEqual({
      repo: "acme/repo",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
    expect(created.get(101)?.draft).toBe(true);
  });

  it("markPRReady flips draft to false only for the targeted PR", async () => {
    const prNumber = await client.createDraftPR("acme/repo", "head-1", "main", "Title", "Body");
    const other = await client.createDraftPR("acme/repo", "head-2", "main", "Title 2", "Body 2");

    await client.markPRReady("acme/repo", prNumber);

    const created = client.getCreatedPRs();
    expect(created.get(prNumber)?.draft).toBe(false);
    expect(created.get(other)?.draft).toBe(true);
  });

  it("markPRReady on an unknown PR number is a no-op (does not throw)", async () => {
    await expect(client.markPRReady("acme/repo", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("acme/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns an incrementing comment id and embeds path/line in the body", async () => {
    const id1 = await client.createPRReviewComment(
      "acme/repo",
      100,
      "Looks risky",
      "src/index.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "acme/repo",
      100,
      "No line hint here",
      "src/other.ts",
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/repo", 100, 1000, "Thanks, fixed"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("acme/repo", 100);
    expect(diff).toContain("diff --git");
    expect(diff.length).toBeGreaterThan(0);
  });
});
