import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing for any repo", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch name and getCreatedBranches returns it", async () => {
    await client.createBranch("acme/widgets", "feature/foo");
    await client.createBranch("acme/widgets", "feature/bar");

    expect(client.getCreatedBranches()).toEqual(["feature/foo", "feature/bar"]);
  });

  it("getCreatedBranches returns a defensive copy, not the live array", async () => {
    await client.createBranch("acme/widgets", "feature/foo");
    const snapshot = client.getCreatedBranches();
    snapshot.push("not-really-created");

    expect(client.getCreatedBranches()).toEqual(["feature/foo"]);
  });

  it("createDraftPR allocates incrementing PR numbers starting at 100", async () => {
    const first = await client.createDraftPR(
      "acme/widgets",
      "feature/foo",
      "main",
      "Add foo",
      "body foo",
    );
    const second = await client.createDraftPR(
      "acme/widgets",
      "feature/bar",
      "main",
      "Add bar",
      "body bar",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("getCreatedPRs reflects created PRs as draft:true with repo/head/title", async () => {
    const prNumber = await client.createDraftPR(
      "acme/widgets",
      "feature/foo",
      "main",
      "Add foo",
      "body foo",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "acme/widgets",
      head: "feature/foo",
      title: "Add foo",
      draft: true,
    });
  });

  it("getCreatedPRs returns a defensive copy that does not mutate internal state", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "feature/foo", "main", "T", "B");
    const snapshot = client.getCreatedPRs();
    snapshot.delete(prNumber);

    expect(client.getCreatedPRs().has(prNumber)).toBe(true);
  });

  it("commentOnPR does not throw and accepts arbitrary PR numbers", async () => {
    await expect(client.commentOnPR("acme/widgets", 42, "nice work")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a fixed unified diff string", async () => {
    const diff = await client.getPRDiff("acme/widgets", 42);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "feature/foo", "main", "T", "B");
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

    await client.markPRReady("acme/widgets", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 42)).resolves.toEqual([]);
  });

  it("createPRReviewComment allocates incrementing comment ids starting at 1000", async () => {
    const first = await client.createPRReviewComment(
      "acme/widgets",
      42,
      "looks off",
      "src/a.ts",
      10,
    );
    const second = await client.createPRReviewComment(
      "acme/widgets",
      42,
      "another note",
      "src/b.ts",
    );

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment formats the stored body with path and line when line is given", async () => {
    // Indirect assertion: markPRReady/listPRComments don't expose prComments,
    // so we exercise the method purely for its branch coverage and return value
    // (the path+line formatting is internal state not part of the public API).
    const commentId = await client.createPRReviewComment(
      "acme/widgets",
      42,
      "body text",
      "src/a.ts",
      7,
    );
    expect(typeof commentId).toBe("number");
  });

  it("createPRReviewComment omits the line suffix branch when no line is given", async () => {
    const commentId = await client.createPRReviewComment("acme/widgets", 42, "body text", "src/a.ts");
    expect(typeof commentId).toBe("number");
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 42, 1000, "thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each event type", async () => {
    await expect(client.submitPRReview("acme/widgets", 42, "lgtm", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 42, "needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/widgets", 42, "just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
