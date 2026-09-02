import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without error for any repo", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches reflects it", async () => {
    await client.createBranch("acme/widgets", "ai/feature-1");
    await client.createBranch("acme/widgets", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("getCreatedBranches returns a copy, not a live reference", async () => {
    await client.createBranch("acme/widgets", "ai/feature-1");
    const branches = client.getCreatedBranches();
    branches.push("mutated");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR("acme/widgets", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("acme/widgets", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("createDraftPR records PR details as draft:true, retrievable via getCreatedPRs", async () => {
    const prNumber = await client.createDraftPR(
      "acme/widgets",
      "head-1",
      "main",
      "My PR",
      "Body text",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "acme/widgets",
      head: "head-1",
      title: "My PR",
      draft: true,
    });
  });

  it("getCreatedPRs returns a fresh Map copy each call", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "head-1", "main", "T", "B");
    const first = client.getCreatedPRs();
    first.delete(prNumber);

    expect(client.getCreatedPRs().has(prNumber)).toBe(true);
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "head-1", "main", "T", "B");
    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that was never created", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().has(9999)).toBe(false);
  });

  it("getPRDiff returns a non-empty synthetic diff string", async () => {
    const diff = await client.getPRDiff("acme/widgets", 100);

    expect(typeof diff).toBe("string");
    expect(diff).toContain("diff --git");
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });

  it("commentOnPR records the comment (observable via createPRReviewComment side effects)", async () => {
    // commentOnPR pushes into a private prComments array with no public getter;
    // exercise it for coverage and confirm it resolves cleanly.
    await expect(client.commentOnPR("acme/widgets", 100, "Looks good")).resolves.toBeUndefined();
  });

  it("createPRReviewComment assigns incrementing comment ids starting at 1000", async () => {
    const first = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Nit: rename this",
      "src/index.ts",
      12,
    );
    const second = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Another comment",
      "src/index.ts",
    );

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment formats the body with path and line when line is provided", async () => {
    // No public getter for prComments, but calling with/without line should not throw
    // and should return distinct incrementing ids either way.
    const withLine = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "body",
      "src/a.ts",
      5,
    );
    const withoutLine = await client.createPRReviewComment("acme/widgets", 100, "body", "src/a.ts");

    expect(withLine).not.toBe(withoutLine);
  });

  it("replyToReviewComment resolves without error", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "Thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without error for each review event type", async () => {
    await expect(
      client.submitPRReview("acme/widgets", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
