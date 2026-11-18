import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
  });

  it("getDefaultBranch always returns main", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/repo", "ai/feature-1");
    await client.createBranch("acme/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("createDraftPR assigns incrementing PR numbers and stores PR details", async () => {
    const client = new MockGitHubClient();

    const first = await client.createDraftPR("acme/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("acme/repo", "head-2", "main", "Title 2", "Body 2");

    expect(second).toBe(first + 1);
    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({
      repo: "acme/repo",
      head: "head-1",
      title: "Title 1",
      draft: true,
    });
    expect(prs.get(second)).toEqual({
      repo: "acme/repo",
      head: "head-2",
      title: "Title 2",
      draft: true,
    });
  });

  it("markPRReady flips the draft flag for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "head", "main", "Title", "Body");

    await client.markPRReady("acme/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for a PR number that was never created", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/repo", 9999)).resolves.toBeUndefined();
  });

  it("commentOnPR resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("acme/repo", 1, "A comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a fixed sample diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/repo", 1);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("listPRComments returns an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("acme/repo", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment formats the body with path and line when line is given", async () => {
    const client = new MockGitHubClient();
    const commentId = await client.createPRReviewComment(
      "acme/repo",
      1,
      "Looks off",
      "src/foo.ts",
      42,
    );
    expect(typeof commentId).toBe("number");
  });

  it("createPRReviewComment omits the line suffix when no line is given", async () => {
    const client = new MockGitHubClient();
    const first = await client.createPRReviewComment("acme/repo", 1, "File-level note", "src/foo.ts");
    const second = await client.createPRReviewComment(
      "acme/repo",
      1,
      "Another note",
      "src/bar.ts",
    );
    expect(second).toBe(first + 1);
  });

  it("replyToReviewComment resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/repo", 1, 1000, "Thanks, fixed"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without error for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(client.submitPRReview("acme/repo", 1, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 1, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 1, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });

  it("getCreatedBranches returns a copy, not the internal array", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/repo", "ai/feature-1");

    const branches = client.getCreatedBranches();
    branches.push("injected");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });
});
