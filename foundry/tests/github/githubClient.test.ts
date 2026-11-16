import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

/**
 * `prComments` is private on MockGitHubClient and has no public getter, but
 * several methods (createPRReviewComment, replyToReviewComment,
 * submitPRReview, commentOnPR) only expose their effect by writing into it.
 * Reading it back via a type assertion lets us assert on that stateful
 * side effect without modifying the source file.
 */
function getStoredComments(client: MockGitHubClient): { prNumber: number; body: string }[] {
  return (client as unknown as { prComments: { prNumber: number; body: string }[] }).prComments;
}

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("verifyRepoAccess resolves without throwing", async () => {
    await expect(client.verifyRepoAccess("acme/widgets")).resolves.toBeUndefined();
  });

  it("getDefaultBranch resolves to main", async () => {
    await expect(client.getDefaultBranch("acme/widgets")).resolves.toBe("main");
  });

  it("createBranch records the branch and makes it retrievable", async () => {
    await client.createBranch("acme/widgets", "feature/foo");
    await client.createBranch("acme/widgets", "feature/bar");

    expect(client.getCreatedBranches()).toEqual(["feature/foo", "feature/bar"]);
  });

  it("getCreatedBranches returns a copy, not a live reference", async () => {
    await client.createBranch("acme/widgets", "feature/foo");
    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["feature/foo"]);
  });

  it("createDraftPR assigns sequential PR numbers starting at 100 and stores the PR as a draft", async () => {
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

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({
      repo: "acme/widgets",
      head: "feature/foo",
      title: "Add foo",
      draft: true,
    });
    expect(prs.get(101)).toEqual({
      repo: "acme/widgets",
      head: "feature/bar",
      title: "Add bar",
      draft: true,
    });
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const prNumber = await client.createDraftPR("acme/widgets", "feature/foo", "main", "T", "B");
    await client.markPRReady("acme/widgets", prNumber);

    const pr = client.getCreatedPRs().get(prNumber);
    expect(pr?.draft).toBe(false);
  });

  it("markPRReady on a non-existent PR number does not throw and leaves state unchanged", async () => {
    await expect(client.markPRReady("acme/widgets", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("getPRDiff returns a fixed diff string containing expected markers", async () => {
    const diff = await client.getPRDiff("acme/widgets", 100);

    expect(diff).toContain("diff --git");
    expect(diff).toContain("+++ b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("createPRReviewComment returns sequential ids starting at 1000 and formats body with [path:line]", async () => {
    const id1 = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Fix this",
      "src/foo.ts",
      42,
    );
    const id2 = await client.createPRReviewComment(
      "acme/widgets",
      100,
      "Also fix this",
      "src/bar.ts",
      7,
    );

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("createPRReviewComment formats the stored body with [path:line] when a line is given", async () => {
    await client.createPRReviewComment("acme/widgets", 100, "Fix this", "src/foo.ts", 42);

    const [comment] = getStoredComments(client);
    expect(comment).toEqual({ prNumber: 100, body: "[src/foo.ts:42] Fix this" });
  });

  it("createPRReviewComment formats the stored body with just [path] when line is omitted", async () => {
    await client.createPRReviewComment("acme/widgets", 100, "No line here", "src/baz.ts");

    const [comment] = getStoredComments(client);
    expect(comment).toEqual({ prNumber: 100, body: "[src/baz.ts] No line here" });
  });

  it("commentOnPR stores the plain comment body against the PR number", async () => {
    await client.commentOnPR("acme/widgets", 100, "Looks good");

    const [comment] = getStoredComments(client);
    expect(comment).toEqual({ prNumber: 100, body: "Looks good" });
  });

  it("replyToReviewComment resolves and stores the reply body against the PR number", async () => {
    await expect(
      client.replyToReviewComment("acme/widgets", 100, 1000, "Thanks for the fix"),
    ).resolves.toBeUndefined();

    const [comment] = getStoredComments(client);
    expect(comment).toEqual({ prNumber: 100, body: "Thanks for the fix" });
  });

  it("submitPRReview resolves and stores the review body against the PR number", async () => {
    await expect(
      client.submitPRReview("acme/widgets", 100, "Overall summary", "APPROVE"),
    ).resolves.toBeUndefined();

    const [comment] = getStoredComments(client);
    expect(comment).toEqual({ prNumber: 100, body: "Overall summary" });
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("acme/widgets", 100)).resolves.toEqual([]);
  });
});
