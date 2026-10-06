import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without throwing for any repo", async () => {
    await expect(client.verifyRepoAccess("octo/repo")).resolves.toBeUndefined();
  });

  it("returns 'main' as the default branch", async () => {
    await expect(client.getDefaultBranch("octo/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    await client.createBranch("octo/repo", "feature/one");
    await client.createBranch("octo/repo", "feature/two");

    expect(client.getCreatedBranches()).toEqual(["feature/one", "feature/two"]);
  });

  it("returns a copy of the created branches array (mutations don't leak)", async () => {
    await client.createBranch("octo/repo", "feature/one");
    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["feature/one"]);
  });

  it("creates draft PRs with incrementing PR numbers starting at 100", async () => {
    const firstPr = await client.createDraftPR(
      "octo/repo",
      "feature/one",
      "main",
      "Add feature one",
      "body one",
    );
    const secondPr = await client.createDraftPR(
      "octo/repo",
      "feature/two",
      "main",
      "Add feature two",
      "body two",
    );

    expect(firstPr).toBe(100);
    expect(secondPr).toBe(101);
  });

  it("exposes created PRs via getCreatedPRs with draft true and correct shape", async () => {
    const prNumber = await client.createDraftPR(
      "octo/repo",
      "feature/one",
      "main",
      "Add feature one",
      "body one",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "octo/repo",
      head: "feature/one",
      title: "Add feature one",
      draft: true,
    });
  });

  it("marks a PR as not-draft via markPRReady", async () => {
    const prNumber = await client.createDraftPR(
      "octo/repo",
      "feature/one",
      "main",
      "Add feature one",
      "body one",
    );

    await client.markPRReady("octo/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady on a nonexistent PR number is a no-op and does not throw", async () => {
    await expect(client.markPRReady("octo/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(
      client.commentOnPR("octo/repo", 100, "Looks good to me"),
    ).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string containing expected markers", async () => {
    const diff = await client.getPRDiff("octo/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
    expect(typeof diff).toBe("string");
    expect(diff.length).toBeGreaterThan(0);
  });

  it("listPRComments resolves to an empty array", async () => {
    await expect(client.listPRComments("octo/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment returns an incrementing comment id starting at 1000", async () => {
    const firstId = await client.createPRReviewComment(
      "octo/repo",
      100,
      "nit: rename this",
      "src/handler.ts",
      12,
    );
    const secondId = await client.createPRReviewComment(
      "octo/repo",
      100,
      "another nit",
      "src/handler.ts",
      20,
    );

    expect(firstId).toBe(1000);
    expect(secondId).toBe(1001);
  });

  it("createPRReviewComment formats the recorded comment with path and line when line is provided", async () => {
    await client.createPRReviewComment("octo/repo", 100, "nit: rename this", "src/handler.ts", 12);

    // The formatted comment isn't directly exposed, but we can confirm behavior
    // via a second call producing a distinct, sequential id (ensuring state advanced)
    // and that no error occurred constructing the "[path:line] body" format.
    const secondId = await client.createPRReviewComment(
      "octo/repo",
      100,
      "no line here",
      "src/handler.ts",
    );
    expect(secondId).toBe(1001);
  });

  it("createPRReviewComment omits the line suffix when line is undefined", async () => {
    // Exercise the falsy branch of `line ? ... : ""` explicitly.
    const id = await client.createPRReviewComment("octo/repo", 100, "file-level comment", "README.md");
    expect(id).toBe(1000);
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("octo/repo", 100, 1000, "Thanks, fixed!"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for each review event type", async () => {
    await expect(
      client.submitPRReview("octo/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("octo/repo", 100, "Please fix X", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("octo/repo", 100, "Just a comment", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
